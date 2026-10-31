#!/usr/bin/env python3
# Vertexhash promo v3 - 20 s vertical 1080x1920, 30 fps. Same approved wording as v1/v2.
# What changed vs v2 (the "crude / synthetic" fixes):
#   look  : metallic gold gradients + bevels instead of flat fills, soft shadows instead of offset copies,
#           glass panels, faceted hex emblem, true 3D spinning coins, Inter Display type with tracking,
#           word-by-word blur/rise reveals, bokeh depth layers + parallax, moving light on the hex grid,
#           light beams, camera drift, scene transitions that push through, motion blur (sub-frames),
#           bloom, chromatic fringe, vignette and film grain (also kills banding in the dark gradients).
#   sound : reverb bus, noise-band whooshes, detuned pad with sidechain pump, kick/hat, inharmonic bells and
#           coin clinks, UI ticks locked to the on-screen events, riser + impact into "Start mining today."
#   video : encoded with explicit BT.709 tags + faststart (v2 had untagged colours), all CPU cores used.
# Needs: Python 3, Pillow, numpy, ffmpeg. Fonts: put Inter/Poppins TTF/OTF files in ./fonts next to this
# script, or rely on the system ones (falls back to DejaVu).
# Full render : python3 promo/render_promo_v3.py          (writes a.wav, v.mp4, out.mp4 in the current folder)
# Sample frames: python3 promo/render_promo_v3.py frames 45 150 255 400 500   (writes f<N>.png)
# Audio only   : python3 promo/render_promo_v3.py audio
# Env: MB=3 motion-blur sub-frames (1 = off, fastest), PROCS=<cores>
import math,os,subprocess,sys,wave
import numpy as np
from multiprocessing import get_context
from PIL import Image,ImageDraw,ImageFont,ImageFilter,ImageChops

W,H,FPS,S=1080,1920,30,2
TOTAL=20.0;N=int(TOTAL*FPS);TR=0.35
MB=max(1,int(os.environ.get('MB',3)));SHUTTER=0.6
HERE=os.path.dirname(os.path.abspath(__file__))

# ------------------------------------------------------------------ fonts
FONT_DIRS=[HERE+'/fonts','/usr/share/fonts/opentype/inter','/usr/share/fonts/truetype/google-fonts','/usr/share/fonts/truetype/dejavu']
FONT_PICK={'xb':['InterDisplay-ExtraBold.otf','Poppins-Bold.ttf','DejaVuSans-Bold.ttf'],
           'sb':['InterDisplay-SemiBold.otf','Poppins-Medium.ttf','DejaVuSans-Bold.ttf'],
           'md':['InterDisplay-Medium.otf','Poppins-Regular.ttf','DejaVuSans.ttf']}
_fp={};_fc={}
def font(s,w='xb'):
    k=(round(s*S),w)
    if k not in _fc:
        if w not in _fp:
            for n_ in FONT_PICK[w]:
                p=[os.path.join(d,n_) for d in FONT_DIRS if os.path.exists(os.path.join(d,n_))]
                if p:_fp[w]=p[0];break
            else:raise SystemExit('no usable font found')
        _fc[k]=ImageFont.truetype(_fp[w],k[0])
    return _fc[k]

# ------------------------------------------------------------------ small helpers
def cl(t):return max(0.0,min(1.0,t))
def ease(t):t=cl(t);return 1-(1-t)**3
def eio(t):t=cl(t);return t*t*(3-2*t)
def spring(t):return 0.0 if t<=0 else 1-math.exp(-6*t)*math.cos(11*t)
def appear(t,t0,dur=.6):return ease((t-t0)/dur)
def lerp(a,b,t):return tuple(a[i]+(b[i]-a[i])*t for i in range(3))
GA=1.0   # global alpha multiplier used while one scene fades its own content out

GOLD=(212,167,58);GOLD2=(245,208,110);DARK=(30,20,2);BGC=(10,8,5)
GOLD_T=((0,(255,238,170)),(0.3,(238,194,84)),(0.55,(178,126,30)),(0.78,(236,192,92)),(1,(160,106,24)))
IVORY_T=((0,(255,252,244)),(1,(214,204,184)))
GOLD_FACE=((0,(255,238,168)),(0.5,(226,180,70)),(1,(192,140,38)))
GLASS=((0,(36,28,15)),(1,(17,13,7)))
RIM=((0,(246,208,118)),(0.5,(128,88,24)),(1,(216,166,62)))

def lingrad(w,h,stops,ang=90):
    w=max(1,int(w));h=max(1,int(h));ps=[s[0] for s in stops]
    if ang==90:
        u=(np.arange(h,dtype=np.float32)+.5)/h
        col=np.stack([np.interp(u,ps,[s[1][c] for s in stops]) for c in range(3)],1)
        arr=np.repeat(col[:,None,:],w,1)
    else:
        a=math.radians(ang);y,x=np.mgrid[0:h,0:w].astype(np.float32)
        d=(x-w/2)*math.cos(a)+(y-h/2)*math.sin(a);ext=abs(w/2*math.cos(a))+abs(h/2*math.sin(a))+1e-6
        u=np.clip(d/(2*ext)+.5,0,1)
        arr=np.stack([np.interp(u,ps,[s[1][c] for s in stops]) for c in range(3)],-1)
    return Image.fromarray(arr.astype(np.uint8),'RGB')
def masked(img,mask):
    im=img.convert('RGBA');im.putalpha(mask);return im

# ------------------------------------------------------------------ compositing primitives
def lay():return Image.new('RGBA',(W*S,H*S),(0,0,0,0))
def alpha_at(layer,sp,x,y):
    L=max(0,-x);Tp=max(0,-y);R=min(sp.width,layer.width-x);B=min(sp.height,layer.height-y)
    if R<=L or B<=Tp:return
    layer.alpha_composite(sp.crop((L,Tp,R,B)),(x+L,y+Tp))
def put(layer,sp,cx,cy,a=1.0):
    a=cl(a*GA)
    if a<=0.004:return
    if a<0.999:
        sp=sp.copy();sp.putalpha(sp.getchannel('A').point(lambda v:int(v*a)))
    alpha_at(layer,sp,int(round(cx*S-sp.width/2)),int(round(cy*S-sp.height/2)))
_gl={}
def glow(layer,cx,cy,r,a,color=(255,184,64)):
    a=cl(a*GA)
    if a<=0.01:return
    n=max(16,int(2*r*S)//8*8)
    if n not in _gl:
        y,x=np.mgrid[0:n,0:n].astype(np.float32);d=np.hypot(x-n/2+.5,y-n/2+.5)/(n/2)
        _gl[n]=Image.fromarray((np.exp(-4.2*d*d)*np.clip(1-d,0,1)**.6*255).astype(np.uint8),'L')
    m=_gl[n];sp=Image.new('RGBA',m.size,color+(0,));sp.putalpha(m.point(lambda v:int(v*a)))
    alpha_at(layer,sp,int(round(cx*S-n/2)),int(round(cy*S-n/2)))
_sh={}
def shadow(layer,cx,cy,w,h,r,blur=18,dy=14,a=.55,ell=False):
    key=(int(w),int(h),int(r),blur,ell);pad=int(blur*3)
    if key not in _sh:
        m=Image.new('L',(int((w+2*pad)*S),int((h+2*pad)*S)),0);d=ImageDraw.Draw(m)
        box=(pad*S,pad*S,(pad+w)*S,(pad+h)*S)
        d.ellipse(box,fill=255) if ell else d.rounded_rectangle(box,r*S,fill=255)
        _sh[key]=m.filter(ImageFilter.GaussianBlur(blur*S/1.2))
    m=_sh[key];sp=Image.new('RGBA',m.size,(0,0,0,0));sp.putalpha(m);put(layer,sp,cx,cy+dy,a)

# ------------------------------------------------------------------ text
_tm={};_tg={}
def tmask(s,size,w='xb',track=0,cell=0):
    k=(s,round(size*S),w,track,cell)
    if k in _tm:return _tm[k]
    f=font(size,w);asc,desc=f.getmetrics();pad=int(size*S*.4)+10
    adv=[cell*S]*len(s) if cell else ([f.getlength(c)+track*S for c in s] if track else None)
    tot=(sum(adv)-(0 if cell else track*S)) if adv else f.getlength(s)
    wd=int(tot)+2*pad;ht=asc+desc+2*pad;m=Image.new('L',(wd,ht),0);d=ImageDraw.Draw(m);base=pad+asc
    if adv:
        x=pad
        for ch,a_ in zip(s,adv):
            d.text((x+a_/2,base),ch,font=f,fill=255,anchor='ms') if cell else d.text((x,base),ch,font=f,fill=255,anchor='ls')
            x+=a_
    else:d.text((wd/2,base),s,font=f,fill=255,anchor='ms')
    _tm[k]=(m,pad+(asc+desc)/2,base);return _tm[k]
def tw(s,size,w='xb',track=0,cell=0):
    f=font(size,w)
    if cell:return cell*len(s)
    return (sum(f.getlength(c) for c in s)+track*S*(len(s)-1))/S if track else f.getlength(s)/S
def fitsz(s,maxw,start,w='xb',track=0):
    z=start
    while tw(s,z,w,track)>maxw and z>20:z-=2
    return z
def text(layer,x,y,s,size,a=1.0,fill='gold',w='xb',blur=0.0,track=0,cell=0,shadow_on=True,shine=None):
    a=cl(a*GA)
    if a<=0.004:return
    m,cy,base=tmask(s,size,w,track,cell)
    if blur>0.3:m=m.filter(ImageFilter.GaussianBlur(blur*S))
    ox=int(round(x*S-m.width/2));oy=int(round(y*S-cy));mk=m.point(lambda v:int(v*a))
    if shadow_on:
        sh=ImageChops.offset(m,0,int(6*S)).filter(ImageFilter.GaussianBlur(9*S))
        sp=Image.new('RGBA',m.size,(0,0,0,0));sp.putalpha(sh.point(lambda v:int(v*.6*a)));alpha_at(layer,sp,ox,oy)
    if isinstance(fill,str):
        stops=GOLD_T if fill=='gold' else IVORY_T;cap=.74*size*S;top=base-cap;key=(fill,m.height,int(top),int(cap))
        if key not in _tg:
            u=np.clip((np.arange(m.height,dtype=np.float32)-top)/cap,0,1);ps=[q[0] for q in stops]
            _tg[key]=np.stack([np.interp(u,ps,[q[1][c] for q in stops]) for c in range(3)],1).astype(np.uint8)
        sp=Image.fromarray(np.repeat(_tg[key][:,None,:],m.width,1),'RGB').convert('RGBA')
    else:sp=Image.new('RGBA',m.size,tuple(fill)+(255,))
    sp.putalpha(mk)
    if isinstance(fill,str):
        hl=ImageChops.subtract(m,ImageChops.offset(m,0,max(2,int(size*S*.012))))
        hs=Image.new('RGBA',m.size,(255,247,222,0));hs.putalpha(hl.point(lambda v:int(v*.7*a)));sp.alpha_composite(hs)
    if shine is not None:
        arr=np.asarray(mk,dtype=np.float32);hh,ww=arr.shape;yy,xx=np.mgrid[0:hh,0:ww]
        band=np.exp(-(((xx+yy*.4)/ww-shine)/.06)**2)
        hs=Image.new('RGBA',m.size,(255,250,230,0));hs.putalpha(Image.fromarray((arr*band*.9).astype(np.uint8),'L'));sp.alpha_composite(hs)
    alpha_at(layer,sp,ox,oy)
def title(layer,y,s,t,t0,fill='ivory',size=96,maxw=860,w='xb',track=0):
    words=s.split(' ');z=fitsz(s,maxw,size,w,track);ws=[tw(q,z,w,track) for q in words];sp=font(z,w).getlength(' ')/S
    x=W/2-(sum(ws)+sp*(len(ws)-1))/2
    for i,(q,wi) in enumerate(zip(words,ws)):
        ai=appear(t,t0+i*.09,.8)
        if ai>0:text(layer,x+wi/2,y+(1-ai)*44,q,z,ai,fill,w,blur=(1-ai)**2*18,track=track)
        x+=wi+sp
def hline(layer,cx,cy,length,th,a,color=(224,178,70)):
    a=cl(a*GA)
    if length<4 or a<=.01:return
    n=int(length*S);hh=max(2,int(th*S));u=np.linspace(0,1,n,dtype=np.float32)
    prof=np.clip(1-np.abs(2*u-1)**2.4,0,1)
    al=(np.repeat(prof[None,:],hh,0)*255*a).astype(np.uint8)
    sp=Image.new('RGBA',(n,hh),color+(0,));sp.putalpha(Image.fromarray(al,'L'));alpha_at(layer,sp,int(cx*S-n/2),int(cy*S-hh/2))

# ------------------------------------------------------------------ sprites (supersampled, cached)
_ps={}
def panel(w,h,r,fill=GLASS,border=RIM,bw=3,falpha=1.0,sheen=0.0,fang=90,bang=60,ss=2):
    w=int(w);h=int(h);key=('p',w,h,int(r),fill,border,bw,falpha,sheen,fang,bang)
    if key in _ps:return _ps[key]
    k=S*ss;Wk,Hk=int(w*k),int(h*k)
    outer=Image.new('L',(Wk,Hk),0);ImageDraw.Draw(outer).rounded_rectangle((0,0,Wk-1,Hk-1),r*k,fill=255)
    inner=Image.new('L',(Wk,Hk),0);ImageDraw.Draw(inner).rounded_rectangle((bw*k,bw*k,Wk-1-bw*k,Hk-1-bw*k),max(1,r-bw)*k,fill=255)
    sp=masked(lingrad(Wk,Hk,border,bang),ImageChops.subtract(outer,inner))
    sp.alpha_composite(masked(lingrad(Wk,Hk,fill,fang),inner.point(lambda v:int(v*falpha))))
    if sheen>0:
        ramp=np.clip(1-np.arange(Hk,dtype=np.float32)/(Hk*.5),0,1)**1.5*sheen*255
        sa=Image.fromarray(np.repeat(ramp[:,None],Wk,1).astype(np.uint8),'L')
        sp.alpha_composite(masked(Image.new('RGB',(Wk,Hk),(255,244,214)),ImageChops.multiply(sa,inner)))
    _ps[key]=sp.resize((int(w*S),int(h*S)),Image.LANCZOS);return _ps[key]

def emblem(layer,cx,cy,r,t,a=1.0):
    if a*GA<=.01 or r<4:return
    ext=r*1.45;ss=2;k=S*ss;side=int(2*ext*k);c=side/2
    im=Image.new('RGBA',(side,side),(0,0,0,0));d=ImageDraw.Draw(im);LIGHT=-2.3
    def shade(ang,lo,hi,p=1.0):
        u=(.5+.5*math.cos(ang-LIGHT))**p;return tuple(int(lo[i]+(hi[i]-lo[i])*u) for i in range(3))+(255,)
    def vert(R,rot,i):return (c+R*k*math.cos(rot+math.pi/3*i),c+R*k*math.sin(rot+math.pi/3*i))
    def ring(Ro,Ri,rot,lo,hi,p=1.0,flip=False):
        for i in range(6):
            mid=rot+math.pi/3*(i+.5)+(math.pi if flip else 0)
            d.polygon([vert(Ro,rot,i),vert(Ro,rot,i+1),vert(Ri,rot,i+1),vert(Ri,rot,i)],fill=shade(mid,lo,hi,p))
    # Vertexhash mark: the Hash-cut V (87 x 78 grid, two slanted cuts through the whole V), gold gradient, soft moving shine
    u=r*.0175*k;ox_,oy_=c-43.5*u,c-39*u
    P=lambda x,y:(ox_+x*u,oy_+y*u)
    vm=Image.new('L',(side,side),0);dv=ImageDraw.Draw(vm)
    dv.polygon([P(0,0),P(28.5,0),P(43.5,44),P(58.5,0),P(87,0),P(43.5,78)],fill=255)
    for (x0,y0,x1,y1) in ((-6,47.1,96,5.6),(-6,65.1,96,23.5)):dv.line((*P(x0,y0),*P(x1,y1)),fill=0,width=int(4*u))
    gold=lingrad(side,side,((0,(246,220,154)),(.5,(233,196,106)),(1,(201,154,58))),62)
    sp_v=masked(gold,vm)
    edge=ImageChops.subtract(vm,ImageChops.offset(vm,0,max(2,int(1.6*k))))
    sp_v.alpha_composite(masked(Image.new('RGB',(side,side),(255,248,226)),edge.point(lambda v:int(v*.65))))
    sx=(t*.35)%1.6-.3;xx_=np.arange(side,dtype=np.float32)[None,:];yy_=np.arange(side,dtype=np.float32)[:,None]
    band=np.exp(-(((xx_+yy_*.5)/side/1.5-sx)/.07)**2)
    sa=Image.fromarray((np.asarray(vm,dtype=np.float32)*band*.75).astype(np.uint8),'L')
    sp_v.alpha_composite(masked(Image.new('RGB',(side,side),(255,250,232)),sa))
    im.alpha_composite(sp_v)
    d=ImageDraw.Draw(im)
    for i in range(48):   # tick ring
        ang=t*.12+i*math.tau/48 if hasattr(math,'tau') else t*.12+i*6.2832/48
        r_a=r*1.20;r_b=r*(1.27 if i%4==0 else 1.24)
        d.line((c+r_a*k*math.cos(ang),c+r_a*k*math.sin(ang),c+r_b*k*math.cos(ang),c+r_b*k*math.sin(ang)),fill=(214,168,70,150 if i%4==0 else 80),width=int(1.6*k))
    d.ellipse((c-r*1.14*k,c-r*1.14*k,c+r*1.14*k,c+r*1.14*k),outline=(214,168,70,60),width=int(1.4*k))
    sp=im.resize((int(side/ss),int(side/ss)),Image.LANCZOS);put(layer,sp,cx,cy,a)
    ang=t*1.1;ox=cx+r*1.14*math.cos(ang);oy=cy+r*1.14*math.sin(ang)   # orbiting spark
    glow(layer,ox,oy,r*.22,.9*a,(255,226,150))

def sparkle(layer,cx,cy,r,a):
    if a*GA<=.01 or r<2:return
    glow(layer,cx,cy,r*1.5,.55*a)
    ss=2;k=S*ss;side=int(r*2.6*k);c=side/2;im=Image.new('RGBA',(side,side),(0,0,0,0));d=ImageDraw.Draw(im)
    d.polygon([(c+r*k*math.cos(p)**3,c+r*k*math.sin(p)**3) for p in np.linspace(0,6.2832,72,endpoint=False)],fill=(255,246,214,255))
    d.ellipse((c-r*1.25*k,c-.035*r*k,c+r*1.25*k,c+.035*r*k),fill=(255,236,170,170))
    d.ellipse((c-.16*r*k,c-.16*r*k,c+.16*r*k,c+.16*r*k),fill=(255,255,240,255))
    put(layer,im.resize((int(side/ss),int(side/ss)),Image.LANCZOS),cx,cy,a)

def disc_sprite(r,stops,rim_stops=RIM,rim=5,ang=90,sheen=0.0):
    key=('d',int(round(r)),stops,rim_stops,rim,ang,sheen)
    if key in _ps:return _ps[key]
    ss=2;k=S*ss;n=int((2*r+6)*k);c=n/2;R=r*k
    def circ(rad):
        m=Image.new('L',(n,n),0);ImageDraw.Draw(m).ellipse((c-rad,c-rad,c+rad,c+rad),fill=255);return m
    outer=circ(R);inner=circ(R-rim*k)
    sp=masked(lingrad(n,n,rim_stops,60),ImageChops.subtract(outer,inner))
    sp.alpha_composite(masked(lingrad(n,n,stops,ang),inner))
    if sheen>0:
        ramp=np.clip(1-np.arange(n,dtype=np.float32)/(n*.55),0,1)**1.6*sheen*255
        sa=Image.fromarray(np.repeat(ramp[:,None],n,1).astype(np.uint8),'L')
        sp.alpha_composite(masked(Image.new('RGB',(n,n),(255,244,214)),ImageChops.multiply(sa,inner)))
    _ps[key]=sp.resize((int((2*r+6)*S),int((2*r+6)*S)),Image.LANCZOS);return _ps[key]

_cs={}
def coin3d(layer,cx,cy,r,spin,a):
    c_=math.cos(spin);ac=abs(c_);q=int(ac*24)
    key=(int(r),q,c_>0)
    if key not in _cs:
        ac=q/24;ss=2;k=S*ss;n=int((2*r+10)*k);c=n/2;rx=max(r*ac,r*.06)*k;ry=r*k
        sh=(r*.15/2)*math.sqrt(max(0,1-ac*ac))*k*(1 if key[2] else -1)
        im=Image.new('RGBA',(n,n),(0,0,0,0));d=ImageDraw.Draw(im);rim=(138,92,16,255)
        d.ellipse((c-sh-rx,c-ry,c-sh+rx,c+ry),fill=rim);d.ellipse((c+sh-rx,c-ry,c+sh+rx,c+ry),fill=rim)
        d.rectangle((c-abs(sh),c-ry,c+abs(sh),c+ry),fill=rim)
        fx=c+sh;frx=rx*.93;fry=ry*.93
        fm=Image.new('L',(n,n),0);ImageDraw.Draw(fm).ellipse((fx-frx,c-fry,fx+frx,c+fry),fill=255)
        im.alpha_composite(masked(lingrad(n,n,GOLD_FACE,60),fm))
        d=ImageDraw.Draw(im);d.ellipse((fx-frx*.74,c-fry*.74,fx+frx*.74,c+fry*.74),outline=(150,100,20,255),width=int(2.2*k))
        d.ellipse((fx-frx*.70,c-fry*.70,fx+frx*.70,c+fry*.70),outline=(255,232,150,130),width=int(1.2*k))
        if ac>.3:
            f=ImageFont.truetype(_fp.get('xb') or font(10,'xb').path,int(r*1.05*k));gm=Image.new('L',(n,n),0)
            ImageDraw.Draw(gm).text((c,c),'$',font=f,fill=255,anchor='mm')
            gw=max(2,int(n*ac));gm=gm.resize((gw,n),Image.BILINEAR);full=Image.new('L',(n,n),0);full.paste(gm,(int(fx-gw/2),0))
            im.alpha_composite(masked(Image.new('RGB',(n,n),(255,238,170)),ImageChops.offset(full,int(k*.8),int(k*.8))))
            im.alpha_composite(masked(Image.new('RGB',(n,n),(112,72,8)),full))
        _cs[key]=im.resize((int((2*r+10)*S),int((2*r+10)*S)),Image.LANCZOS)
    put(layer,_cs[key],cx,cy,a)

def beam(layer,p0,p1,wid,a,color=(255,205,110),core=(255,238,184)):
    a=cl(a*GA)
    if a<=.01:return
    pad=int(wid*4+10);x0=int(min(p0[0],p1[0])-pad);y0=int(min(p0[1],p1[1])-pad);x1=int(max(p0[0],p1[0])+pad);y1=int(max(p0[1],p1[1])+pad)
    w_,h_=(x1-x0)*S,(y1-y0)*S;g=Image.new('L',(w_,h_),0)
    pts=((p0[0]-x0)*S,(p0[1]-y0)*S,(p1[0]-x0)*S,(p1[1]-y0)*S)
    ImageDraw.Draw(g).line(pts,fill=255,width=max(1,int(wid*S)))
    sp=Image.new('RGBA',(w_,h_),color+(0,));sp.putalpha(g.filter(ImageFilter.GaussianBlur(wid*S*1.5)).point(lambda v:int(min(255,v*.8*a))));alpha_at(layer,sp,x0*S,y0*S)
    if core:
        g2=Image.new('L',(w_,h_),0);ImageDraw.Draw(g2).line(pts,fill=255,width=max(1,int(wid*S*.45)))
        sp=Image.new('RGBA',(w_,h_),core+(0,));sp.putalpha(g2.filter(ImageFilter.GaussianBlur(S*.6)).point(lambda v:int(v*a)));alpha_at(layer,sp,x0*S,y0*S)

# ------------------------------------------------------------------ scenes
def s1(t):
    im=lay();a=ease(t/.9)
    glow(im,540,760,560,.50*a*(.9+.1*math.sin(t*3)),(255,170,56))
    ss=Image.new('RGBA',(int(1000*S),int(24*S)),(0,0,0,0))    # anamorphic streak
    xs=np.linspace(-1,1,ss.width,dtype=np.float32);ys=np.linspace(-1,1,ss.height,dtype=np.float32)[:,None]
    ss.putalpha(Image.fromarray((np.exp(-(xs/.55)**2-(ys/.16)**2)*255).astype(np.uint8),'L'))
    sp_=Image.new('RGBA',ss.size,(255,214,130,0));sp_.putalpha(ss.getchannel('A'));put(im,sp_,540,760,.5*a*ease((t-.2)/.8))
    emblem(im,540,760,200*(.5+.5*spring(t/1.2)),t,a)
    ai=appear(t,.5,.9);sh=(-.3+1.6*cl((t-1.5)/1.3)) if 1.5<t<2.9 else None
    text(im,540,1095+(1-ai)*40,'VERTEXHASH',fitsz('VERTEXHASH',900,170,'xb',10),ai,'gold','xb',blur=(1-ai)**2*20,track=10,shine=sh)
    a2=appear(t,.95,.8);text(im,540,1245+(1-a2)*26,'CLOUD MINING',46,a2,'ivory','sb',blur=(1-a2)**2*10,track=20,shadow_on=False)
    hline(im,540,1318,520*ease((t-1.1)/.9),3,.9)
    return im

def s2(t):
    im=lay()
    title(im,520,'Real mining power.',t,.2,'ivory',104)
    title(im,650,'No hardware to buy.',t,.6,'gold',104)
    a=appear(t,1.0,.8)
    if a>0:
        cy0=1140+(1-a)*50;pw,ph=900,590
        shadow(im,540,cy0,pw,ph,48,28,26,.6*a);put(im,panel(pw,ph,48,GLASS,RIM,3,.80,.10),540,cy0,a)
        x0,x1,y=160,920,cy0+150;p=eio((t-1.2)/1.8);xe=x0+(x1-x0)*p
        glow(im,540,cy0-110,300,.22*a)
        th=1+int(p*299)
        text(im,540,cy0-120,str(th),210,a,'gold','xb',cell=128,shadow_on=True)
        text(im,540,cy0-4,'TH/s',54,a,'ivory','sb',track=10,shadow_on=False)
        put(im,panel(x1-x0,24,12,((0,(8,6,3)),(1,(30,23,13))),((0,(70,54,28)),(1,(70,54,28))),1),540,y,a)
        wd=max(28,xe-x0);put(im,panel(wd,24,12,GOLD_FACE,((0,(255,240,180)),(1,(190,136,36))),1,1,.55),x0+wd/2,y,a)
        glow(im,xe,y,130,.65*a)
        ring=(t*1.2)%1;rr=34+ring*44
        rs=Image.new('RGBA',(int(2*rr*S+8),int(2*rr*S+8)),(0,0,0,0));ImageDraw.Draw(rs).ellipse((4,4,rs.width-4,rs.height-4),outline=(245,208,110,255),width=int(3*S))
        put(im,rs,xe,y,a*(1-ring)*.8)
        shadow(im,xe,y,70,70,35,10,10,.55*a,True);put(im,disc_sprite(34,((0,(255,246,214)),(1,(222,176,66))),RIM,5,90,.5),xe,y,a)
        for i in range(5):
            put(im,Image.new('RGBA',(int(3*S),int(16*S)),(168,152,120,255)),x0+(x1-x0)*i/4,y+56,a*.8)
    return im

def s3(t):
    im=lay()
    title(im,560,'Pick your power.',t,.2,'ivory',108)
    title(im,690,'Pick your term.',t,.6,'gold',108)
    cy=1100;xs=[240,540,840];tm=['90','180','365']
    s=(t-1.4)/.7;tgt=int(max(0,min(2,math.floor(s))));prog=eio((s-tgt)/.35) if tgt>0 else 1
    xi=(tgt-1)+prog if tgt>0 else 0;xh=xs[0]+(xs[1]-xs[0])*xi;ha=ease(s/.3) if s>0 else 0
    for i,x in enumerate(xs):
        a=appear(t,1.0+i*.15,.7);yo=(1-a)*60
        shadow(im,x,cy+yo,240,300,36,22,18,.5*a);put(im,panel(240,300,36,GLASS,RIM,3,.82,.10),x,cy+yo,a)
    if ha>0:
        glow(im,xh,cy,250,.55*ha)
        shadow(im,xh,cy-6,256,316,40,26,22,.6*ha);put(im,panel(256,316,40,GOLD_FACE,((0,(255,244,196)),(1,(214,160,52))),3,1,.38,90,60),xh,cy-6,ha)
    for i,x in enumerate(xs):
        a=appear(t,1.0+i*.15,.7);yo=(1-a)*60;pr=cl(1-abs(x-xh)/200)*ha;lift=-6*pr
        text(im,x,cy-25+yo+lift,tm[i],100,a,'ivory' if pr<.5 else (46,31,4),'xb',shadow_on=pr<.5,cell=62)
        text(im,x,cy+72+yo+lift,'days',40,a,tuple(int(v) for v in lerp((170,156,126),(80,56,10),pr)),'md',shadow_on=False)
    return im

COINS=['BTC','KAS','RVN','XMR','ETC']
def s4(t):
    im=lay()
    title(im,430,'Smart Mining',t,.2,'gold',114)
    title(im,560,'One miner. Five coins.',t,.6,'ivory',84)
    cx,cy,R=540,1130,330;a=appear(t,.9,.8)
    act=int((t-1.3)/.5)%5 if t>1.3 else -1;u=((t-1.3)%.5)/.5 if t>1.3 else 0
    pos=[(cx+R*math.cos(-math.pi/2+i*2*math.pi/5),cy+R*math.sin(-math.pi/2+i*2*math.pi/5)) for i in range(5)]
    glow(im,cx,cy,260,.5*a)
    for i,(x,y) in enumerate(pos):
        on=(i==act)
        beam(im,(cx,cy),(x,y),7 if on else 3,a*(.95 if on else .7),(255,205,110) if on else (150,116,54),(255,238,184) if on else (176,140,70))
    if act>=0:
        x,y=pos[act];e=eio(u);px,py=x+(cx-x)*e,y+(cy-y)*e
        glow(im,px,py,70,.95*(1-u*.4),(255,226,150));glow(im,px,py,22,1,(255,250,225))
    emblem(im,cx,cy,86,t,a)
    for i,(x,y) in enumerate(pos):
        ai=appear(t,.9+i*.1,.6);on=(i==act)
        r=68*(1.2-.1*ease(u) if on else 1)*(.6+.4*ai)
        if on:glow(im,x,y,170,.75)
        shadow(im,x,y,2*r,2*r,r,16,14,.55*ai,True)
        put(im,disc_sprite(r,GOLD_FACE if on else GLASS,RIM,5,90,.35 if on else .12),x,y,ai)
        text(im,x,y,COINS[i],44 if on else 40,ai,(46,31,4) if on else 'ivory','sb',shadow_on=not on)
    return im

def s5(t):
    global GA
    im=lay()
    if t<2.45:
        GA=1-ease((t-2.0)/.4) if t>2.0 else 1.0
        title(im,520,'Daily payouts',t,.2,'ivory',112)
        title(im,650,'to your wallet.',t,.6,'gold',112)
        a=appear(t,.9,.8);land=[1.45+k*.13 for k in range(5)]
        bump=sum(.035*math.exp(-(t-l)*9) for l in land if t>l)
        cx_,cy_=540,1385
        glow(im,cx_,cy_,360,.35*a+bump*3)
        for k in range(5):   # coins fall BEHIND the wallet, so they slide into it
            tt=(t-land[k]+.7)/.7
            if 0<tt<1.2:
                e=tt*tt;x=540-80+(k%3)*60;y=900+e*350
                coin3d(im,x,y,40,tt*9.4+k*1.3,min(1,tt*5))
        sp=wallet_sprite();sc=1+bump
        spr=sp.resize((int(sp.width*sc),int(sp.height*sc)),Image.BILINEAR) if bump>.002 else sp
        shadow(im,cx_,cy_+10,480*sc,270*sc,50,30,26,.6*a);put(im,spr,cx_,cy_,a)
        for k in range(5):
            ls=t-land[k]
            if 0<ls<.35:sparkle(im,540-80+(k%3)*60,1250,10+34*ease(ls/.35),1-ls/.35)
        GA=1.0
    if t>=2.1:
        u=t-2.1
        glow(im,540,930,480,.38*ease(u/.8))
        emblem(im,540,600,74,t,ease(u/.6))
        title(im,810,'Start mining',u,0.0,'ivory',124)
        title(im,965,'today.',u,.25,'gold',150)
        a=appear(u,.7,.6)
        if a>0:
            pulse=1+.025*math.sin(u*6);w,h=660*pulse,190*pulse
            glow(im,540,1215,400,.55*a*(.7+.3*math.sin(u*6)))
            shadow(im,540,1215,w,h,h/2,28,24,.6*a)
            put(im,panel(w,h,h/2,GOLD_FACE,((0,(255,244,196)),(1,(200,146,44))),3,1,.42,90,60),540,1215,a)
            text(im,540,1215,'Vertexhash',fitsz('Vertexhash',560,64,'xb'),a,(46,31,4),'xb',shadow_on=False)
            pos=-.3+1.7*((u*.7)%1.4)/1.4
            bm=np.asarray(panel(w,h,h/2,GOLD_FACE,((0,(255,244,196)),(1,(200,146,44))),3,1,.42,90,60).getchannel('A'),dtype=np.float32)
            hh,ww=bm.shape;yy,xx=np.mgrid[0:hh,0:ww];band=np.exp(-(((xx+yy*.5)/ww-pos)/.09)**2)
            sh_=Image.new('RGBA',(ww,hh),(255,250,232,0));sh_.putalpha(Image.fromarray((bm*band*.8).astype(np.uint8),'L'));put(im,sh_,540,1215,a)
            for k in range(6):
                su=u-.5-k*.08
                if 0<su<.5:
                    ang=k*1.05;sparkle(im,540+430*math.cos(ang),1215+170*math.sin(ang),26*math.sin(su/.5*math.pi),1)
    return im

_ws=None
def wallet_sprite():
    global _ws
    if _ws is not None:return _ws
    ss=2;k=S*ss;w,h=480,270;pad=24;Wk,Hk=int((w+2*pad)*k),int((h+2*pad)*k);o=pad*k
    im=Image.new('RGBA',(Wk,Hk),(0,0,0,0));d=ImageDraw.Draw(im)
    def rrm(box,r):
        m=Image.new('L',(Wk,Hk),0);ImageDraw.Draw(m).rounded_rectangle([v*k+(o if i%2==0 else o) for i,v in enumerate(box)],r*k,fill=255);return m
    body=rrm((0,0,w,h),48);inner=rrm((5,5,w-5,h-5),43)
    im.alpha_composite(masked(lingrad(Wk,Hk,RIM,60),ImageChops.subtract(body,inner)))
    im.alpha_composite(masked(lingrad(Wk,Hk,((0,(58,44,24)),(0.5,(36,27,14)),(1,(20,15,8))),75),inner))
    d=ImageDraw.Draw(im)
    for i in range(36):     # stitching
        x=o+(26+i*(w-52)/36)*k;d.line((x,o+22*k,x+7*k,o+22*k),fill=(214,168,70,150),width=int(2*k))
        d.line((x,o+(h-22)*k,x+7*k,o+(h-22)*k),fill=(214,168,70,110),width=int(2*k))
    flap=rrm((w-170,86,w+14,178),46)     # clasp tab
    fm=Image.new('L',(Wk,Hk),0);ImageDraw.Draw(fm).rounded_rectangle((o+(w-170)*k,o+86*k,o+(w+14)*k,o+178*k),46*k,fill=255)
    sd=fm.filter(ImageFilter.GaussianBlur(7*k));sa=Image.new('RGBA',(Wk,Hk),(0,0,0,0));sa.putalpha(ImageChops.offset(sd,0,int(5*k)).point(lambda v:int(v*.6)));im.alpha_composite(sa)
    im.alpha_composite(masked(lingrad(Wk,Hk,GOLD_FACE,70),fm))
    d=ImageDraw.Draw(im);bx=o+(w-52)*k;by=o+132*k
    d.ellipse((bx-17*k,by-17*k,bx+17*k,by+17*k),fill=(40,27,5,255));d.ellipse((bx-17*k,by-17*k,bx+17*k,by+17*k),outline=(255,232,150,200),width=int(2*k))
    d.ellipse((bx-6*k,by-6*k,bx+6*k,by+6*k),fill=(214,168,70,255))
    sl=Image.new('L',(Wk,Hk),0);ImageDraw.Draw(sl).rounded_rectangle((o+110*k,o+3*k,o+(w-110)*k,o+16*k),7*k,fill=255)   # coin slot lip
    im.alpha_composite(masked(lingrad(Wk,Hk,((0,(255,236,160)),(1,(150,100,20))),90),sl))
    _ws=im.resize((int((w+2*pad)*S),int((h+2*pad)*S)),Image.LANCZOS);return _ws

SC=[(0.0,3.75,s1),(3.75,3.75,s2),(7.5,3.75,s3),(11.25,3.75,s4),(15.0,5.0,s5)]

# ------------------------------------------------------------------ background, particles, camera, post
GRIDM=None;VIG=None;PART=[]
def init():
    global GRIDM,VIG,PART
    rng=np.random.default_rng(7)
    g=Image.new('L',(W*S,H*S),0);d=ImageDraw.Draw(g)
    for ry in range(-1,16):
        for rx in range(-1,10):
            cx=rx*156+(78 if ry%2 else 0);cy=ry*135
            pts=[((cx+90*math.cos(math.pi/6+math.pi/3*i))*S,(cy+90*math.sin(math.pi/6+math.pi/3*i))*S) for i in range(6)]
            if rng.random()<.30:d.polygon(pts,fill=int(rng.uniform(14,40)))
            d.line(pts+[pts[0]],fill=255,width=2)
    GRIDM=g
    y,x=np.mgrid[0:H,0:W].astype(np.float32);dd=np.hypot((x/W-.5)*1.05,(y/H-.47)*.9)
    VIG=(1-.55*np.clip((dd-.30)/.55,0,1)**1.7).astype(np.float32)
    PART=[]
    for _ in range(9):PART.append(('far',rng.uniform(0,W),rng.uniform(0,H),rng.uniform(14,34),rng.uniform(9,24),rng.uniform(0,6.28),rng.uniform(.05,.11)))
    for _ in range(46):PART.append(('dust',rng.uniform(0,W),rng.uniform(0,H),rng.uniform(1.2,3.2),rng.uniform(14,46),rng.uniform(0,6.28),rng.uniform(.35,.8)))
    for _ in range(4):PART.append(('near',rng.uniform(0,W),rng.uniform(0,H),rng.uniform(60,110),rng.uniform(28,50),rng.uniform(0,6.28),rng.uniform(.05,.09)))

def bg_field(T_):
    w8,h8=W//8,H//8;yy,xx=np.mgrid[0:h8,0:w8].astype(np.float32);X=((xx+.5)/w8-.5)*W/H;Y=(yy+.5)/h8-.5
    d=np.hypot(X,Y+.06);g=.50*np.exp(-(d/.19)**2)+.20*np.exp(-(d/.48)**2)
    def band(ang,off,wd):return np.exp(-((X*math.cos(ang)+Y*math.sin(ang)-off)/wd)**2)
    b=(.13*band(.95,.18*math.sin(T_*.25),.07)+.09*band(.95,-.22+.12*math.sin(T_*.19+1.3),.05))*np.clip(.9-Y*1.2,0,1.2)
    col=np.array(BGC,np.float32)+(g+b)[...,None]*np.array((92,64,14),np.float32)
    return Image.fromarray(np.clip(col,0,255).astype(np.uint8),'RGB').resize((W,H),Image.BICUBIC)
def grid_light(T_):
    w8,h8=W//8,H//8;yy,xx=np.mgrid[0:h8,0:w8].astype(np.float32);X=((xx+.5)/w8)*W/H;Y=(yy+.5)/h8;f=np.full((h8,w8),.045,np.float32)
    for cx,cy,s in ((.5+.35*math.cos(.5*T_),.45+.30*math.sin(.4*T_),.25),(.5+.40*math.sin(.31*T_+2),.6+.30*math.cos(.37*T_),.22),(.5,.40+.04*math.sin(T_*2),.30)):
        f+=.85*np.exp(-(np.hypot(X-cx*W/H,Y-cy)/s)**2)
    return Image.fromarray((np.clip(f,0,1)*118).astype(np.uint8),'L').resize((W,H),Image.BILINEAR)
def cam_box(z,dx,dy,w,h):
    cw,ch=w/z,h/z;x0=max(0,min(w-cw,(w-cw)/2+dx));y0=max(0,min(h-ch,(h-cw*h/w)/2+dy));return (x0,y0,x0+cw,y0+ch)
_bk={}
def bokeh(r,kind):
    key=(int(r),kind)
    if key not in _bk:
        n=int(3.0*r+10);y,x=np.mgrid[0:n,0:n].astype(np.float32);dd=np.hypot(x-n/2+.5,y-n/2+.5)/r
        if kind=='dust':al=np.exp(-(dd/.55)**2*2.2)
        else:
            sm=lambda a,b,v:np.clip((v-a)/(b-a),0,1)**2*(3-2*np.clip((v-a)/(b-a),0,1))
            al=(.55+.45*sm(.6,.98,dd))*(1-sm(.9,1.0,dd));al=np.where(dd<1.0,al,0)
        m=Image.fromarray((al*255).astype(np.uint8),'L')
        if kind!='dust':m=m.filter(ImageFilter.GaussianBlur(max(1.2,r*.08 if kind=='far' else r*.18)))
        sp=Image.new('RGBA',m.size,(255,205,112,0));sp.putalpha(m);_bk[key]=sp
    return _bk[key]
def draw_particles(base,T_,which):
    for kind,x0,y0,r,sp,ph,al in PART:
        if kind not in which:continue
        y=(y0-sp*T_)%(H+240)-120;x=x0+22*math.sin(T_*.5+ph)
        a=al*(1 if kind!='dust' else .55+.45*math.sin(T_*2.3+ph))
        s_=bokeh(r,kind);s_=s_.copy();s_.putalpha(s_.getchannel('A').point(lambda v:int(v*a)))
        L=int(x-s_.width/2);Tp=int(y-s_.height/2)
        if L>W or Tp>H or L+s_.width<0 or Tp+s_.height<0:continue
        a0=max(0,-L);b0=max(0,-Tp);a1=min(s_.width,W-L);b1=min(s_.height,H-Tp)
        base.alpha_composite(s_.crop((a0,b0,a1,b1)),(L+a0,Tp+b0))

def render_fg(T_):
    comp=None
    for i,(st,dur,fn) in enumerate(SC):
        t=T_-st;end=dur+(TR if i<4 else 0)
        if t<0 or t>=end+1e-9:continue
        im=fn(t);f=ease(cl(t/(.5 if i==0 else TR)));sc=1.0
        if i>0 and t<TR:sc=1.05-.05*ease(t/TR)
        if i<4 and t>dur:
            x=(t-dur)/TR;f=min(f,1-eio(x));sc=1+.07*eio(x)
        if sc>1.001:
            bx=cam_box(sc,0,0,im.width,im.height);im=im.resize(im.size,Image.BICUBIC,box=bx)
        if f<.999:im.putalpha(im.getchannel('A').point(lambda v:int(v*f)))
        comp=im if comp is None else Image.alpha_composite(comp,im)
    if comp is None:return Image.new('RGBA',(W,H),(0,0,0,0))
    z=1.03+.05*T_/TOTAL;dx=11*math.sin(.7*T_)*S;dy=8*math.sin(.45*T_+1)*S
    return comp.resize((W,H),Image.BICUBIC,box=cam_box(z,dx,dy,comp.width,comp.height))

def frame(n):
    T_=n/FPS;zb=1.015+.02*T_/TOTAL
    bg=bg_field(T_)
    gl=ImageChops.multiply(GRIDM.resize((W,H),Image.LANCZOS,box=cam_box(zb,-4*math.sin(.7*T_)*S*.5,-3*math.sin(.45*T_+1)*S*.5,W*S,H*S)),grid_light(T_))
    bg.paste((214,168,72),(0,0),gl)
    bga=bg.convert('RGBA');draw_particles(bga,T_,('far','dust'))
    offs=[((j+.5)/MB-.5)*SHUTTER/FPS for j in range(MB)] if MB>1 else [0.0]
    accC=np.zeros((H,W,3),np.float32);accA=np.zeros((H,W,1),np.float32)
    for o in offs:
        f=np.asarray(render_fg(T_+o),dtype=np.float32)/255;al=f[...,3:4];accC+=f[...,:3]*al;accA+=al
    accC/=len(offs);accA/=len(offs)
    out=np.asarray(bga.convert('RGB'),dtype=np.float32)*(1-accA)+accC*255
    img=Image.fromarray(np.clip(out,0,255).astype(np.uint8),'RGB').convert('RGBA')
    draw_particles(img,T_*1.0+7,('near',));img=img.convert('RGB')
    r,g,b=img.split()
    r=r.resize((W,H),Image.BICUBIC,box=cam_box(1.0035,0,0,W,H));g=g.resize((W,H),Image.BICUBIC,box=cam_box(1.0017,0,0,W,H))
    img=Image.merge('RGB',(r,g,b));a=np.asarray(img,dtype=np.float32)
    sm=np.asarray(img.resize((W//4,H//4),Image.BILINEAR),dtype=np.float32);br=Image.fromarray(np.clip((sm-135)*1.5,0,255).astype(np.uint8))
    b1=np.asarray(br.filter(ImageFilter.GaussianBlur(4)).resize((W,H),Image.BICUBIC),dtype=np.float32)
    b2=np.asarray(br.filter(ImageFilter.GaussianBlur(14)).resize((W,H),Image.BICUBIC),dtype=np.float32)
    a=a+.45*b1+.40*b2;a*=VIG[...,None]
    a+=np.random.default_rng(n*7919+1).standard_normal((H,W,1)).astype(np.float32)*2.4
    return Image.fromarray(np.clip(a,0,255).astype(np.uint8),'RGB')

# ------------------------------------------------------------------ audio (numpy only)
SR=44100;NS=int(SR*TOTAL)
def audio(path='a.wav'):
    rng=np.random.default_rng(11)
    DL=np.zeros(NS);DR=np.zeros(NS);PL=np.zeros(NS);PR=np.zeros(NS);SEND=np.zeros(NS)
    def tt(d):return np.arange(int(d*SR))/SR
    def put_(buf,st,sig):
        i=int(round(st*SR))
        if i>=NS or i+len(sig)<=0:return
        a=max(0,-i);j=min(len(sig),NS-i);buf[i+a:i+j]+=sig[a:j]
    def pan_g(p):return math.cos((p+1)*math.pi/4),math.sin((p+1)*math.pi/4)
    def ev(st,sig,g=1.0,pan=0.0,send=0.0):
        gl,gr=pan_g(pan);put_(DL,st,sig*g*gl);put_(DR,st,sig*g*gr)
        if send:put_(SEND,st,sig*g*send)
    def filt(x,lo=None,hi=None,order=2):
        n=len(x);X=np.fft.rfft(x);f=np.fft.rfftfreq(n,1/SR);gn=np.ones_like(f)
        if hi:gn/=np.sqrt(1+(f/hi)**(2*order))
        if lo:gn*=1/np.sqrt(1+(lo/np.maximum(f,1e-9))**(2*order))
        return np.fft.irfft(X*gn,n)
    def sweep(d,rising=True,win='sym',lo=250,hi=7000):
        n=int(d*SR);t=np.arange(n)/SR;X=np.fft.rfft(rng.standard_normal(n));f=np.fft.rfftfreq(n,1/SR);out=np.zeros(n);cs=np.geomspace(lo,hi,18)
        for i,fc in enumerate(cs):
            band=np.fft.irfft(X*np.exp(-(np.log(np.maximum(f,1)/fc)/.32)**2),n)
            pk=.15+.7*i/17 if rising else .85-.7*i/17;out+=band*np.exp(-((t/d-pk)/.22)**2)
        out*=np.sin(np.pi*np.clip(t/d,0,1))**1.5 if win=='sym' else np.clip(t/d,0,1)**2.2*np.clip((d-t)/.03,0,1)
        return out/(np.abs(out).max()+1e-9)
    def whoosh(st,d=.8,amp=.30,p0=-.6,p1=.6):
        s=sweep(d);t=np.arange(len(s))/SR;pn=p0+(p1-p0)*t/d;gl=np.cos((pn+1)*math.pi/4);gr=np.sin((pn+1)*math.pi/4)
        put_(DL,st,s*amp*gl);put_(DR,st,s*amp*gr);put_(SEND,st,s*amp*.5)
    def swish(st,amp=.07):
        s=sweep(.32,True,'sym',1800,9000);ev(st,s,amp,rng.uniform(-.4,.4),.35)
    def kick(st,amp=.55):
        t=tt(.45);ph=2*np.pi*np.cumsum(42+120*np.exp(-t*34))/SR;body=np.sin(ph)*np.exp(-t*8.5)
        click=filt(rng.standard_normal(len(t)),2500,9000)*np.exp(-t*420)*.22
        ev(st,body*amp+click*amp,1.0,0,.04)
    def hat(st,amp=.06,pan=.3):
        t=tt(.09);s=filt(rng.standard_normal(len(t)),7000,None)*np.exp(-t*60);ev(st,s,amp*4,pan,.18)
    def bell(st,f,amp=.10,dec=.5,pan=0.0,send=.45):
        t=tt(dec*7);s=np.zeros_like(t)
        for r_,a_,dd in ((1,1,1),(2.76,.45,.55),(5.40,.22,.30),(8.93,.10,.18)):
            s+=a_*np.sin(2*np.pi*f*r_*t+rng.uniform(0,6))*np.exp(-t/(dec*dd))
        s*=np.minimum(t/.003,1);s+=filt(rng.standard_normal(len(t)),3000,9000)*np.exp(-t*500)*.10
        ev(st,s,amp,pan,send)
    def coin(st,f0,amp=.08,pan=0.0):
        t=tt(.9);s=np.zeros_like(t)
        for r_,a_,dd in ((1,1,.22),(2.32,.7,.15),(4.25,.5,.1),(6.63,.32,.07),(9.38,.18,.05)):
            s+=a_*np.sin(2*np.pi*f0*r_*t+rng.uniform(0,6))*np.exp(-t/dd)
        s*=np.minimum(t/.001,1);s+=filt(rng.standard_normal(len(t)),4000,None)*np.exp(-t*700)*.5
        ev(st,s,amp,pan,.4)
    def tick(st,f,amp=.05,pan=0.0):
        t=tt(.06);s=np.sin(2*np.pi*f*t)*np.exp(-t*150)+filt(rng.standard_normal(len(t)),2000,8000)*np.exp(-t*900)*.4;ev(st,s,amp,pan,.2)
    def pop(st,f=520,amp=.12,pan=0.0):
        t=tt(.18);ph=2*np.pi*np.cumsum(f*(.5+.5*np.exp(-t*30)))/SR;s=np.sin(ph)*np.exp(-t*24)*np.minimum(t/.004,1);ev(st,s,amp,pan,.25)
    def thump(st,amp=.10):
        t=tt(.25);ph=2*np.pi*np.cumsum(140-60*np.minimum(t/.1,1))/SR;ev(st,np.sin(ph)*np.exp(-t*22)*np.minimum(t/.003,1),amp,0,.1)
    def impact(st,amp=.7,low=True):
        t=tt(2.6);ph=2*np.pi*np.cumsum(32+70*np.exp(-t*1.6))/SR;s=np.sin(ph)*np.exp(-t/1.0)*amp
        s+=filt(rng.standard_normal(len(t)),None,900)*np.exp(-t/.35)*amp*.55 + filt(rng.standard_normal(len(t)),3500,None)*np.exp(-t/1.1)*amp*.14
        ev(st,s*np.minimum(t/.002,1),1.0,0,.55)
    def riser(st,d,amp=.2):
        s=sweep(d,True,'ramp',300,9000);t=np.arange(len(s))/SR
        tone=np.sin(2*np.pi*np.cumsum(300*(1+5*(t/d)**2))/SR)*(t/d)**2*.25
        ev(st,(s+tone)*amp,1.0,0,.5)
    # ---- pads, bass
    CH=[(0,3.75,[110,164.8,220,261.6,329.6],55),(3.75,3.75,[87.3,130.8,174.6,220,261.6],43.65),(7.5,3.75,[130.8,196,261.6,329.6,392],65.4),
        (11.25,3.75,[98,146.8,196,246.9,293.7],49),(15,2.1,[82.4,123.5,164.8,196,246.9],41.2),(17.1,2.9,[130.8,196,261.6,293.7,329.6,392,523.3],65.4)]
    for st0,du,fr,root in CH:
        s0=max(0,st0-.8);d=min(TOTAL-s0,du+(st0-s0)+.8);t=tt(d);L_=np.zeros_like(t);R_=np.zeros_like(t)
        for f in fr:
            for det,pn in ((-.0045,-.7),(0,0),(.0045,.7)):
                ff=f*(1+det);ph=rng.uniform(0,6.28);vib=1+.0012*np.sin(2*np.pi*(.25+.07*rng.random())*t+ph);s=np.zeros_like(t)
                for h_ in range(1,11):
                    if ff*h_>9000:break
                    s+=np.sin(2*np.pi*ff*h_*t*vib+ph*h_)/h_**1.15/np.sqrt(1+(ff*h_/1300)**4)
                gl,gr=pan_g(pn);L_+=s*gl;R_+=s*gr
        env=np.minimum(t/1.0,1)**2*np.minimum((d-t)/1.2,1)**2*(.03/len(fr)*3.2)
        put_(PL,s0,L_*env);put_(PR,s0,R_*env);put_(SEND,s0,(L_+R_)*env*.35)
        bt=np.sin(2*np.pi*root*t)+.5*np.sin(4*np.pi*root*t)+.18*np.sin(6*np.pi*root*t);be=np.minimum(t/.6,1)**2*np.minimum((d-t)/.8,1)**2*.14
        put_(PL,s0,bt*be);put_(PR,s0,bt*be)
    # ---- beat (grid chosen so a kick lands exactly on the 17.1 s reveal)
    kicks=[17.1-.5*k for k in range(0,20) if 17.1-.5*k>=7.5]+[17.1+.5*k for k in range(1,5)]
    kicks=sorted(kicks)
    for kt in kicks:
        kick(kt,.5 if kt!=17.1 else .62);hat(kt+.25,.05,.35 if int(kt*2)%2 else -.35)
    # ---- scene by scene sound design
    impact(.05,.20);riser(0,.9,.10);bell(.5,659,.07,.7,-.2,.6);bell(1.5,1760,.05,.8,.2,.6);swish(.5,.06);swish(.95,.05)
    for b_ in (3.75,7.5,11.25,15.0):whoosh(b_-.4)
    for b_ in (3.75,7.5,11.25):swish(b_+.2);swish(b_+.6)
    swish(15.2);swish(15.6)
    # s2 counter: a tick every 10 TH/s, pitch rising
    for k in range(1,30):
        p=10*k/299.0;x=.5-math.sin(math.asin(1-2*p)/3);tick(3.75+1.2+1.8*x,1500+1500*k/30,.045,.15*math.sin(k))
    bell(3.75+3.0,1318.5,.08,.9,0,.6)
    # s3 card pops, highlight hops
    for i,f in enumerate((440,523,659)):pop(7.5+1.0+.15*i,f,.11,(-.5,0,.5)[i])
    tick(7.5+1.4,880,.07);tick(7.5+2.1,1175,.08,0);tick(7.5+2.8,1568,.08,.4)
    # s4 coin nodes and bells (one per coin hit, panned like the node)
    pn=[(math.cos(-math.pi/2+i*2*math.pi/5)) for i in range(5)]
    for i in range(5):pop(11.25+.9+.1*i,600+60*i,.07,pn[i]*.5)
    for k in range(7):bell(11.25+1.3+k*.5,(659,784,880,988,1175)[k%5],.10,.35,pn[k%5]*.5,.5)
    # s5 payouts: coin clinks on landing, then riser -> impact -> reveal
    for k in range(5):
        lt=15+1.45+k*.13;coin(lt,2700+rng.uniform(-150,500),.09,rng.uniform(-.3,.3));thump(lt,.06)
    riser(15.4,1.7,.15);impact(17.1,.30)
    for i,f in enumerate((523.3,659.3,784,1046.5,1318.5)):bell(17.12+.06*i,f,.07,.9,-.4+.2*i,.6)
    pop(17.8,700,.10,0);tick(17.8,2000,.06)
    for k in range(6):bell(17.6+k*.08,(2093,2637,3136,2349,2794,3520)[k],.025,.35,rng.uniform(-.6,.6),.6)
    # ---- reverb bus
    def make_ir(seed,rt=2.4):
        r_=np.random.default_rng(seed);n=int(SR*rt*1.2);t=np.arange(n)/SR;X=np.fft.rfft(r_.standard_normal(n));f=np.fft.rfftfreq(n,1/SR)
        a=1/np.sqrt(1+(f/600)**4);b=1/np.sqrt(1+(f/3500)**4)
        lo=np.fft.irfft(X*a,n);mid=np.fft.irfft(X*(b-a)*(b>a),n);hi=np.fft.irfft(X*(1-b),n)
        tau=rt/6.9;ir=lo*np.exp(-t/tau)+.8*mid*np.exp(-t/(tau*.7))+.5*hi*np.exp(-t/(tau*.35));ir*=np.clip(t/.012,0,1)
        ir=np.concatenate([np.zeros(int(.018*SR)),ir]);return ir/np.sqrt((ir**2).sum())
    def conv(x,ir):
        n=len(x)+len(ir)-1;m=1<<(n-1).bit_length();return np.fft.irfft(np.fft.rfft(x,m)*np.fft.rfft(ir,m),m)[:NS]
    WL=conv(SEND,make_ir(1))*5.0;WR=conv(SEND,make_ir(2))*5.0
    # ---- sidechain pump on pad/bass, then master
    tg=np.arange(NS)/SR;duck=np.ones(NS)
    for kt in kicks:
        i=int(kt*SR);seg=np.arange(min(NS-i,int(.5*SR)))/SR;duck[i:i+len(seg)]=np.minimum(duck[i:i+len(seg)],1-.30*np.exp(-seg/.13))
    L=DL+PL*duck+WL*.55;R=DR+PR*duck+WR*.55
    hp=lambda x:filt(x,28,None)
    L=hp(L);R=hp(R)
    fade=np.clip((TOTAL-tg)/1.6,0,1)**1.5*np.clip(tg/.25,0,1);L*=fade;R*=fade
    seg=slice(int(2*SR),int(16*SR));rms=math.sqrt(((L[seg]**2).mean()+(R[seg]**2).mean())/2);k_=.122/rms;L*=k_;R*=k_
    L=np.tanh(L/.9)*.9;R=np.tanh(R/.9)*.9
    pcm=(np.stack([L,R],1)*32767*.97).astype('<i2')
    with wave.open(path,'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(pcm.tobytes())

# ------------------------------------------------------------------ main
def _render(n):return frame(n).tobytes()
if __name__=='__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else 'full'
    if mode=='audio':audio();print('a.wav written');sys.exit()
    init()
    if mode=='frames':
        for n in map(int,sys.argv[2:]):frame(n).save(f'f{n}.png')
        sys.exit()
    audio()
    ff=['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
        '-vf','scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-crf','16','-preset','slow',
        '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','v.mp4']
    p=subprocess.Popen(ff,stdin=subprocess.PIPE,stderr=open('ff.log','w'))
    procs=int(os.environ.get('PROCS',os.cpu_count() or 1))
    with get_context('fork').Pool(procs) as pool:
        for i,buf in enumerate(pool.imap(_render,range(N),chunksize=2)):
            p.stdin.write(buf)
            if i%30==0:print(i,flush=True)
    p.stdin.close();p.wait()
    subprocess.run(['ffmpeg','-y','-i','v.mp4','-i','a.wav','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart','-shortest','out.mp4'],stderr=open('ff2.log','w'))
    print('done')
