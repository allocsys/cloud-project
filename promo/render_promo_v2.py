# Promo video v2 (work in progress): 20 s vertical 1080x1920, 30 fps, drawn at 2x and scaled down, slow push-in,
# particles, glows, crossfades and a generated sound track (music bed, whooshes, ticks, coin sounds).
# Same approved wording as v1 (promo/render_promo.py). Needs Python 3, Pillow, numpy, ffmpeg and DejaVu Sans fonts.
# Full render: python3 promo/render_promo_v2.py  (writes a.wav, v.mp4 and out.mp4 in the current folder; slow on one core).
# Sample frames only: python3 promo/render_promo_v2.py frames 45 150 255 400 500  (writes f<N>.png)
import math,subprocess,random,sys,wave
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
W,H,FPS,S=1080,1920,30,2
GOLD=(212,167,58);GOLD2=(245,208,110);TXT=(240,232,214);DIM=(150,138,112);BG=(11,9,6);DARK=(30,20,2)
FB='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';FR='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
_fc={}
def font(s,b=True):
    k=(round(s*S),b)
    if k not in _fc:_fc[k]=ImageFont.truetype(FB if b else FR,k[0])
    return _fc[k]
def cl(t):return max(0,min(1,t))
def ease(t):t=cl(t);return 1-(1-t)**3
def eio(t):t=cl(t);return t*t*(3-2*t)
def backo(t):
    t=cl(t);c1=1.70158;c3=c1+1;return 1+c3*(t-1)**3+c1*(t-1)**2
GA=1.0
def col(c,a=1):return tuple(int(v) for v in c)+(int(255*cl(a*GA)),)
def lerp(a,b,t):return tuple(a[i]+(b[i]-a[i])*t for i in range(3))
def tw(s,size,b=True):return font(size,b).getlength(s)/S
def fitsz(s,maxw,start):
    z=start
    while tw(s,z)>maxw and z>20:z-=2
    return z
def T(dr,x,y,s,size,fill,b=True):dr.text((x*S,y*S),s,font=font(size,b),fill=fill,anchor='mm')
def E(dr,cx,cy,rx,ry,fill=None,outline=None,w=0):dr.ellipse(((cx-rx)*S,(cy-ry)*S,(cx+rx)*S,(cy+ry)*S),fill=fill,outline=outline,width=int(w*S))
def RR(dr,box,r,fill=None,outline=None,w=0):dr.rounded_rectangle([v*S for v in box],r*S,fill=fill,outline=outline,width=int(w*S))
def LN(dr,a,b,fill,w):dr.line((a[0]*S,a[1]*S,b[0]*S,b[1]*S),fill=fill,width=int(w*S))
def hexpts(cx,cy,r,rot=0):return [(cx+r*math.cos(math.pi/3*i+rot),cy+r*math.sin(math.pi/3*i+rot)) for i in range(6)]
def HX(dr,cx,cy,r,rot,outline,w):dr.polygon([(x*S,y*S) for x,y in hexpts(cx,cy,r,rot)],outline=outline,width=int(w*S))
# glow sprite
def _gs():
    n=256;y,x=np.mgrid[0:n,0:n];d=np.hypot(x-n/2,y-n/2)/(n/2);a=np.clip(1-d,0,1)**2
    arr=np.zeros((n,n,4),np.uint8);arr[...,0]=255;arr[...,1]=196;arr[...,2]=70;arr[...,3]=(a*255).astype(np.uint8)
    return Image.fromarray(arr,'RGBA')
GS=_gs()
def alpha_at(layer,sp,x,y):
    L=max(0,-x);Tp=max(0,-y);R=min(sp.width,layer.width-x);B=min(sp.height,layer.height-y)
    if R<=L or B<=Tp:return
    layer.alpha_composite(sp.crop((L,Tp,R,B)),(x+L,y+Tp))
def glow(layer,cx,cy,r,a):
    a*=GA
    if a<=0.01:return
    sz=max(2,int(2*r*S));sp=GS.resize((sz,sz),Image.BILINEAR)
    sp.putalpha(sp.getchannel('A').point(lambda v:int(v*cl(a))))
    alpha_at(layer,sp,int(cx*S-sz/2),int(cy*S-sz/2))
def sparkle(dr,cx,cy,r,a):
    if a<=0 or r<=0:return
    pts=[]
    for i in range(8):
        rad=r if i%2==0 else r*0.28;ang=math.pi/4*i-math.pi/2
        pts.append(((cx+rad*math.cos(ang))*S,(cy+rad*math.sin(ang))*S))
    dr.polygon(pts,fill=col((255,240,190),a))
def shine_mask(layer,mask,x,y,pos,a=1):
    w,h=mask.size
    yy,xx=np.mgrid[0:h,0:w];u=(xx+yy*0.5)/w
    band=np.exp(-((u-pos)/0.09)**2)
    mk=(np.array(mask)*band*cl(a*GA)).astype(np.uint8)
    hi=Image.new('RGBA',(w,h),(255,248,225,255));hi.putalpha(Image.fromarray(mk))
    alpha_at(layer,hi,int(x*S-w/2),int(y*S-h/2))
def shine_text(layer,x,y,s,size,pos,a=1):
    f=font(size);w=int(f.getlength(s))+80;h=int(size*S*1.6)
    m=Image.new('L',(w,h),0);ImageDraw.Draw(m).text((w//2,h//2),s,font=f,fill=255,anchor='mm')
    shine_mask(layer,m,x,y,pos,a)
def lay():
    im=Image.new('RGBA',(W*S,H*S),(0,0,0,0));return im,ImageDraw.Draw(im)
def appear(t,t0,dur=.6):return ease((t-t0)/dur)
def title(dr,y,s,t,t0,fill=TXT,size=96,maxw=900):
    a=appear(t,t0)
    if a<=0:return
    z=fitsz(s,maxw,size);yy=y+(1-a)*50
    T(dr,W/2,yy+5,s,z,col((0,0,0),a*0.45));T(dr,W/2,yy,s,z,col(fill,a))
def logo(dr,cx,cy,r,t,a=1):
    HX(dr,cx,cy,r,t*0.6,col(GOLD,a),7);HX(dr,cx,cy,r*0.62,-t*0.9,col(GOLD,a),5)
    E(dr,cx,cy,r*1.28,r*1.28,outline=col(GOLD,a*0.25),w=2)
    E(dr,cx,cy,r*.14,r*.14,fill=col(GOLD2,a))
def coin(dr,cx,cy,r,a=1):
    E(dr,cx,cy,r,r,fill=col(GOLD,a),outline=col(GOLD2,a),w=4)
    T(dr,cx,cy,'$',r*1.1,col((60,40,5),a))
# background (2x, prerendered)
def make_bg():
    bg=Image.new('RGB',(W*S,H*S),BG)
    g=Image.new('L',(W//4,H//4),0);ImageDraw.Draw(g).ellipse((W//8-150,H//8-175,W//8+150,H//8+175),fill=60)
    g=g.filter(ImageFilter.GaussianBlur(55)).resize((W*S,H*S),Image.BILINEAR)
    bg.paste(Image.new('RGB',(W*S,H*S),(90,64,12)),(0,0),g)
    d=ImageDraw.Draw(bg)
    for ry in range(-1,16):
        for rx in range(-1,10):
            cx=rx*156+(78 if ry%2 else 0);cy=ry*135
            HX(d,cx,cy,90,math.pi/6,(24,19,11),1)
    return bg.convert('RGBA')
random.seed(7)
PART=[(random.uniform(0,W),random.uniform(0,H),random.uniform(18,50),random.uniform(1.5,4),random.uniform(0,6.28)) for _ in range(38)]
def particles(base,T_):
    d=ImageDraw.Draw(base,'RGBA')
    for x0,y0,sp,r,ph in PART:
        y=(y0-sp*T_)%(H+40)-20;x=x0+18*math.sin(T_*0.7+ph)
        a=0.25+0.2*math.sin(T_*2+ph)
        E(d,x,y,r,r,fill=(245,208,110,int(255*a)))
# ---------------- scenes
def s1(t):
    im,dr=lay();a=ease(t/0.9)
    glow(im,540,760,430,0.55*a*(0.85+0.15*math.sin(t*3)))
    sc=0.5+0.5*backo(t/1.1)
    logo(dr,540,760,200*sc,t,a)
    title(dr,1080,'OPUS',t,0.5,GOLD2,170)
    shine_text(im,540,1080,'OPUS',170,-0.3+1.6*cl((t-1.3)/1.2),appear(t,0.5)*(1 if t<2.6 else 0))
    title(dr,1230,'C L O U D   M I N I N G',t,0.9,TXT,52)
    wl=420*ease((t-1.0)/0.8)
    if wl>0:LN(dr,(540-wl/2,1310),(540+wl/2,1310),col(GOLD,0.8),3)
    return im
def s2(t):
    im,dr=lay()
    title(dr,520,'Real mining power.',t,0.2,TXT,100)
    title(dr,650,'No hardware to buy.',t,0.6,GOLD2,100)
    a=appear(t,1.0)
    if a>0:
        x0,x1,y=140,940,1150
        p=eio((t-1.2)/1.8);xe=x0+(x1-x0)*p
        glow(im,xe,y,150,0.7*a)
        RR(dr,(x0,y-14,x1,y+14),14,fill=col((50,42,28),a))
        RR(dr,(x0,y-14,max(x0+28,xe),y+14),14,fill=col(GOLD,a))
        ring=(t*1.2)%1
        E(dr,xe,y,34+ring*40,34+ring*40,outline=col(GOLD2,a*(1-ring)*0.8),w=3)
        E(dr,xe,y,34,34,fill=col(GOLD2,a),outline=col((255,240,200),a),w=4)
        th=1+int(p*299)
        glow(im,540,y-170,260,0.18*a)
        T(dr,540,y-170,str(th),190,col(TXT,a));T(dr,540,y-60,'TH/s',54,col(GOLD,a))
        for i in range(5):
            LN(dr,(x0+(x1-x0)*i/4,y+60),(x0+(x1-x0)*i/4,y+80),col(DIM,a),3)
    return im
def s3(t):
    im,dr=lay()
    title(dr,560,'Pick your power.',t,0.2,TXT,104)
    title(dr,690,'Pick your term.',t,0.6,GOLD2,104)
    cy=1100;xs=[240,540,840];tm=['90','180','365']
    s=(t-1.4)/0.7
    tgt=int(max(0,min(2,math.floor(s))))
    prog=eio((s-tgt)/0.35) if tgt>0 else 1
    xi=(tgt-1)+prog if tgt>0 else 0
    xh=xs[0]+(xs[1]-xs[0])*xi;ha=ease(s/0.3) if s>0 else 0
    for i,x in enumerate(xs):
        a=appear(t,1.0+i*0.15);yo=(1-a)*60
        RR(dr,(x-120,cy-150+yo,x+120,cy+150+yo),36,fill=col((28,22,13),a),outline=col(GOLD,a),w=3)
    if ha>0:
        glow(im,xh,cy,230,0.5*ha)
        RR(dr,(xh-128,cy-158,xh+128,cy+158),40,fill=col(GOLD,ha),outline=col(GOLD2,ha),w=3)
    for i,x in enumerate(xs):
        a=appear(t,1.0+i*0.15);yo=(1-a)*60
        pr=cl(1-abs(x-xh)/200)*ha
        T(dr,x,cy-25+yo,tm[i],96,col(lerp(TXT,DARK,pr),a))
        T(dr,x,cy+70+yo,'days',40,col(lerp(DIM,(50,35,5),pr),a),False)
    return im
COINS=['BTC','KAS','RVN','XMR','ETC']
def s4(t):
    im,dr=lay()
    title(dr,430,'Smart Mining',t,0.2,GOLD2,110)
    title(dr,560,'One miner. Five coins.',t,0.6,TXT,80)
    cx,cy,R=540,1130,330;a=appear(t,0.9)
    act=int((t-1.3)/0.5)%5 if t>1.3 else -1;u=((t-1.3)%0.5)/0.5 if t>1.3 else 0
    pos=[(cx+R*math.cos(-math.pi/2+i*2*math.pi/5),cy+R*math.sin(-math.pi/2+i*2*math.pi/5)) for i in range(5)]
    glow(im,cx,cy,200,0.5*a)
    for i,(x,y) in enumerate(pos):
        on=(i==act);LN(dr,(cx,cy),(x,y),col(GOLD if on else (70,58,34),a),6 if on else 3)
    if act>=0:
        x,y=pos[act];e=eio(u);px,py=x+(cx-x)*e,y+(cy-y)*e
        glow(im,px,py,60,0.9*(1-u*0.4));E(dr,px,py,12,12,fill=col((255,240,190),1))
    logo(dr,cx,cy,90,t,a)
    for i,(x,y) in enumerate(pos):
        ai=appear(t,0.9+i*0.1);on=(i==act)
        bump=1+0.2*ease(1-u)*0 if not on else 1.2-0.1*ease(u)
        r=68*bump*(0.6+0.4*ai)
        if on:glow(im,x,y,150,0.7)
        E(dr,x,y,r,r,fill=col(GOLD if on else (28,22,13),ai),outline=col(GOLD,ai),w=5)
        T(dr,x,y,COINS[i],44 if on else 40,col(DARK if on else TXT,ai))
    return im
def s5(t):
    global GA
    im,dr=lay()
    if t<2.15:
        GA=1-ease((t-1.75)/0.35) if t>1.75 else 1.0
        title(dr,520,'Daily payouts',t,0.2,TXT,110)
        title(dr,650,'to your wallet.',t,0.6,GOLD2,110)
        a=appear(t,0.9)
        land=[1.7+k*0.22 for k in range(5)]
        bump=sum(0.035*math.exp(-(t-l)*9) for l in land if t>l)
        wx0,wx1,wy0,wy1=300,780,1250,1520;cx_,cy_=540,1385
        hw,hh=240*(1+bump),135*(1+bump)
        glow(im,cx_,cy_,330,0.35*a+bump*3)
        RR(dr,(cx_-hw,cy_-hh,cx_+hw,cy_+hh),50,fill=col((32,25,14),a),outline=col(GOLD,a),w=6)
        RR(dr,(wx1-150,wy0+90,wx1+10,wy0+180),40,fill=col(GOLD,a))
        E(dr,wx1-50,wy0+137,15,15,fill=col(DARK,a))
        for k in range(5):
            tt=(t-1.0-k*0.22)/0.7
            if 0<tt<1:
                e=tt*tt;x=540-80+(k%3)*60;y=900+e*350
                for q in (3,2,1):coin(dr,x,y-q*26*tt,40*(1-0.08*q),0.18*(4-q)/3*min(1,tt*5))
                coin(dr,x,y,40,min(1,tt*5))
            ls=t-land[k]
            if 0<ls<0.35:sparkle(dr,540-80+(k%3)*60,1250,10+34*ease(ls/0.35),1-ls/0.35)
        GA=1.0
    if t>=2.1:
        u=t-2.1
        glow(im,540,930,420,0.35*ease(u/0.8))
        logo(dr,540,600,70,t,ease(u/0.6))
        title(dr,800,'Start mining',u,0.0,TXT,120)
        title(dr,950,'today.',u,0.25,GOLD2,140)
        a=appear(u,0.7)
        if a>0:
            pulse=1+0.025*math.sin(u*6);w,h=330*pulse,95*pulse
            glow(im,540,1200,360,0.55*a*(0.7+0.3*math.sin(u*6)))
            RR(dr,(540-w,1200-h,540+w,1200+h),95,fill=col(GOLD,a))
            T(dr,540,1200,'Opus Cloud Mining',fitsz('Opus Cloud Mining',560,52),col(DARK,a))
            m=Image.new('L',(int(2*w*S),int(2*h*S)),0);ImageDraw.Draw(m).rounded_rectangle((0,0,m.width-1,m.height-1),95*S,fill=255)
            shine_mask(im,m,540,1200,-0.3+1.7*((u*0.7)%1.4)/1.4*1.0,a*0.8)
            for k in range(6):
                su=u-0.5-k*0.08
                if 0<su<0.5:
                    ang=k*1.05;sparkle(dr,540+420*math.cos(ang),1200+160*math.sin(ang),26*math.sin(su/0.5*math.pi),1)
    return im
SC=[(0.0,3.75,s1),(3.75,3.75,s2),(7.5,3.75,s3),(11.25,3.75,s4),(15.0,5.0,s5)]
TOTAL=20.0;N=int(TOTAL*FPS)
def frame(n,bgim):
    T_=n/FPS
    base=bgim.copy();particles(base,T_)
    for i,(st,dur,fn) in enumerate(SC):
        t=T_-st
        if t<0 or t>=dur+(0.35 if i<4 else 0)+1e-9:continue
        im=fn(t)
        f=cl(t/(0.5 if i==0 else 0.35))
        if i<4 and t>dur:f=min(f,(dur+0.35-t)/0.35)
        if f<1:im.putalpha(im.getchannel('A').point(lambda v:int(v*f)))
        base.alpha_composite(im)
    z=1+0.035*T_/TOTAL;cw,ch=W*S/z,H*S/z
    box=((W*S-cw)/2,(H*S-ch)/2,(W*S+cw)/2,(H*S+ch)/2)
    return base.convert('RGB').resize((W,H),Image.LANCZOS,box=box)
# ---------------- audio
SR=44100
def audio():
    L=np.zeros(SR*20);R=np.zeros(SR*20)
    def put(buf,st,sig):
        i=int(st*SR);j=min(len(buf),i+len(sig))
        if i<len(buf):buf[i:j]+=sig[:j-i]
    def tt(d):return np.arange(int(d*SR))/SR
    chords=[[110,164.8,220,261.6],[87.3,130.8,174.6,220],[130.8,196,261.6,329.6],[98,146.8,196,246.9]]
    for c,fr in enumerate(chords):
        d=6.2;t=tt(d);env=np.sin(np.pi*np.clip(t/d,0,1))**2
        for f in fr:
            for buf,dt in((L,-0.35),(R,0.35)):
                s=np.sin(2*np.pi*(f+dt)*t)+0.3*np.sin(4*np.pi*(f+dt)*t)+0.12*np.sin(6*np.pi*(f+dt)*t)
                put(buf,c*5-0.6 if c>0 else 0,s*env*0.045*(1+0.15*np.sin(2*np.pi*0.3*t)))
    for k in range(int((19-7.5)/0.5)):
        st=7.5+k*0.5;t=tt(0.28);f=45+75*np.exp(-t*30)
        s=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*9)*0.30;put(L,st,s);put(R,st,s)
    rng=np.random.default_rng(3)
    for st in (3.2,6.95,10.7,14.45):
        d=0.7;t=tt(d);env=np.sin(np.pi*t/d)**2;f=200+2300*(t/d)**2
        s=np.sin(2*np.pi*np.cumsum(f)/SR)*env*0.07+rng.standard_normal(len(t))*env*0.025
        put(L,st+0.0,s);put(R,st+0.0,s)
    t=tt(1.8);env=np.sin(np.pi*np.clip(t/1.8,0,1))
    s=np.sin(2*np.pi*np.cumsum(220+440*(t/1.8))/SR)*env*0.05;put(L,4.95,s);put(R,4.95,s)
    def bell(st,f,amp,dec=0.4,d=1.2):
        t=tt(d);s=(np.sin(2*np.pi*f*t)+0.35*np.sin(2*np.pi*2.01*f*t))*np.exp(-t/dec)*np.minimum(t/0.004,1)*amp
        put(L,st,s);put(R,st,s)
    pent=[659,784,880,988,1175]
    for k in range(7):bell(11.25+1.3+k*0.5,pent[k%5],0.11,0.35,0.9)
    for k in range(5):bell(15+1.7+k*0.22,1760,0.10,0.18,0.5)
    for f in (220,261.6,329.6,440):
        t=tt(2.6);s=np.sin(2*np.pi*f*t)*np.exp(-t/1.1)*np.minimum(t/0.05,1)*0.07;put(L,17.1,s);put(R,17.1,s)
    bell(17.35,1760,0.10,0.6,1.8)
    n=len(L);fade=np.clip((20-np.arange(n)/SR)/1.2,0,1);fi=np.clip(np.arange(n)/SR/0.4,0,1)
    L*=fade*fi;R*=fade*fi
    pk=max(abs(L).max(),abs(R).max());L*=0.85/pk;R*=0.85/pk
    st=np.stack([L,R],1);pcm=(st*32767).astype('<i2')
    with wave.open('a.wav','wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(pcm.tobytes())
if __name__=='__main__':
    bgim=make_bg()
    if len(sys.argv)>1 and sys.argv[1]=='frames':
        for n in map(int,sys.argv[2:]):frame(n,bgim).save(f'f{n}.png')
    else:
        audio()
        p=subprocess.Popen(['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','17','-preset','medium','v.mp4'],stdin=subprocess.PIPE,stderr=open('ff.log','w'))
        for n in range(N):
            p.stdin.write(frame(n,bgim).tobytes())
            if n%60==0:print(n,flush=True)
        p.stdin.close();p.wait()
        subprocess.run(['ffmpeg','-y','-i','v.mp4','-i','a.wav','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','out.mp4'],stderr=open('ff2.log','w'))
        print('done')
