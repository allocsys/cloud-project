# Renders the 20 s vertical (1080x1920, 30 fps) promo video: python3 promo/render_promo.py
# Needs Python 3, Pillow, ffmpeg and the DejaVu Sans fonts. Writes out.mp4 in the current folder, ffmpeg log in ff.log.
# Text only: no profit numbers or claims. Scenes: logo, power slider, terms, Smart Mining coins, payouts and call to action.
import math,subprocess
from PIL import Image,ImageDraw,ImageFont,ImageFilter
W,H,FPS=1080,1920,30
GOLD=(212,167,58);GOLD2=(245,208,110);TXT=(240,232,214);DIM=(150,138,112);BG=(11,9,6)
FB='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';FR='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
_fc={}
def font(s,b=True):
    k=(s,b)
    if k not in _fc:_fc[k]=ImageFont.truetype(FB if b else FR,s)
    return _fc[k]
def ease(t):t=max(0,min(1,t));return 1-(1-t)**3
def eio(t):t=max(0,min(1,t));return t*t*(3-2*t)
# background: dark with a soft gold glow and a faint hex pattern
bg=Image.new('RGB',(W,H),BG)
glow=Image.new('L',(W,H),0);gd=ImageDraw.Draw(glow);gd.ellipse((W//2-600,H//2-700,W//2+600,H//2+700),fill=60)
glow=glow.filter(ImageFilter.GaussianBlur(220))
bg.paste(Image.new('RGB',(W,H),(90,64,12)),(0,0),glow)
d=ImageDraw.Draw(bg)
def hexpts(cx,cy,r,rot=0):return [(cx+r*math.cos(math.pi/3*i+rot),cy+r*math.sin(math.pi/3*i+rot)) for i in range(6)]
for ry in range(-1,16):
    for rx in range(-1,10):
        cx=rx*156+(78 if ry%2 else 0);cy=ry*135
        d.polygon(hexpts(cx,cy,90,math.pi/6),outline=(24,19,11))
def tw(t,f):return d.textlength(t,font=f)
def fit(t,maxw,start):
    s=start
    while tw(t,font(s))>maxw and s>20:s-=2
    return font(s)
def lay():
    im=Image.new('RGBA',(W,H),(0,0,0,0));return im,ImageDraw.Draw(im)
def rr(dr,box,r,fill=None,outline=None,w=3):dr.rounded_rectangle(box,r,fill=fill,outline=outline,width=w)
def appear(t,t0,dur=.6):return ease((t-t0)/dur)
def title(dr,y,s,t,t0,fill=TXT,size=96,maxw=900):
    a=appear(t,t0)
    if a<=0:return
    f=fit(s,maxw,size);yy=y+int((1-a)*50)
    col=tuple(int(c) for c in fill)+(int(255*a),)
    dr.text((W//2,yy),s,font=f,fill=col,anchor='mm')
def coin(dr,cx,cy,r,a=1,fill=GOLD):
    dr.ellipse((cx-r,cy-r,cx+r,cy+r),fill=fill+(int(255*a),),outline=GOLD2+(int(255*a),),width=4)
    dr.text((cx,cy),'$',font=font(int(r*1.1)),fill=(60,40,5,int(255*a)),anchor='mm')
def logo(dr,cx,cy,r,t,a=1):
    for k,(rr_,wd) in enumerate([(r,8),(r*0.62,5)]):
        dr.polygon(hexpts(cx,cy,rr_,t*(0.6 if k==0 else -0.9)),outline=GOLD+(int(255*a),),width=wd)
    dr.ellipse((cx-r*.14,cy-r*.14,cx+r*.14,cy+r*.14),fill=GOLD2+(int(255*a),))
def s1(t):
    im,dr=lay()
    a=ease(t/1.0)
    logo(dr,W//2,760,190*(0.7+0.3*a),t,a)
    title(dr,1080,'VERTEXHASH',t,0.5,GOLD2,100)
    title(dr,1230,'C L O U D   M I N I N G',t,0.9,TXT,52)
    return im
def s2(t):
    im,dr=lay()
    title(dr,520,'Real mining power.',t,0.2,TXT,100)
    title(dr,650,'No hardware to buy.',t,0.6,GOLD2,100)
    a=appear(t,1.0)
    if a>0:
        x0,x1,y=140,940,1150
        p=eio((t-1.2)/1.8)
        dr.rounded_rectangle((x0,y-14,x1,y+14),14,fill=(50,42,28,int(255*a)))
        xe=x0+(x1-x0)*p
        dr.rounded_rectangle((x0,y-14,max(x0+28,xe),y+14),14,fill=GOLD+(int(255*a),))
        dr.ellipse((xe-34,y-34,xe+34,y+34),fill=GOLD2+(int(255*a),),outline=(255,240,200,int(255*a)),width=4)
        th=1+int(p*299)
        dr.text((W//2,y-170),str(th),font=font(190),fill=TXT+(int(255*a),),anchor='mm')
        dr.text((W//2,y-60),'TH/s',font=font(54),fill=GOLD+(int(255*a),),anchor='mm')
        for i in range(0,5):
            dr.line((x0+(x1-x0)*i/4,y+60,x0+(x1-x0)*i/4,y+80),fill=DIM+(int(255*a),),width=3)
    return im
def s3(t):
    im,dr=lay()
    title(dr,560,'Pick your power.',t,0.2,TXT,104)
    title(dr,690,'Pick your term.',t,0.6,GOLD2,104)
    a=appear(t,1.0)
    if a>0:
        terms=['90','180','365'];sel=min(2,int(max(0,t-1.4)/0.7))
        for i,tm in enumerate(terms):
            cx=W//2+(i-1)*300;cy=1100;on=(i==sel)
            sc=1.08 if on else 1
            w,h=120*sc,150*sc
            rr(dr,(cx-w,cy-h,cx+w,cy+h),36,fill=(GOLD+(int(255*a),) if on else (28,22,13,int(255*a))),outline=GOLD+(int(255*a),))
            dr.text((cx,cy-25),tm,font=font(int(96*sc)),fill=((30,20,2,int(255*a)) if on else TXT+(int(255*a),)),anchor='mm')
            dr.text((cx,cy+70),'days',font=font(40,False),fill=((50,35,5,int(255*a)) if on else DIM+(int(255*a),)),anchor='mm')
    return im
COINS=['BTC','KAS','RVN','XMR','ETC']
def s4(t):
    im,dr=lay()
    title(dr,430,'Smart Mining',t,0.2,GOLD2,110)
    title(dr,560,'One miner. Five coins.',t,0.6,TXT,80)
    cx,cy,R=W//2,1130,330
    a=appear(t,0.9)
    act=int(max(0,t-1.3)/0.5)%5 if t>1.3 else -1
    for i,c in enumerate(COINS):
        ang=-math.pi/2+i*2*math.pi/5
        x,y=cx+R*math.cos(ang),cy+R*math.sin(ang)
        on=(i==act)
        col=GOLD+(int(255*a),) if on else (70,58,34,int(255*a))
        dr.line((cx,cy,x,y),fill=col,width=6 if on else 3)
    logo(dr,cx,cy,90,t,a)
    for i,c in enumerate(COINS):
        ang=-math.pi/2+i*2*math.pi/5
        x,y=cx+R*math.cos(ang),cy+R*math.sin(ang)
        on=(i==act);r=82 if on else 68
        aa=int(255*a)
        dr.ellipse((x-r,y-r,x+r,y+r),fill=(GOLD+(aa,) if on else (28,22,13,aa)),outline=GOLD+(aa,),width=5)
        dr.text((x,y),c,font=font(44 if on else 40),fill=((30,20,2,aa) if on else TXT+(aa,)),anchor='mm')
    return im
def s5(t):
    im,dr=lay()
    if t<2.1:
        title(dr,520,'Daily payouts',t,0.2,TXT,110)
        title(dr,650,'to your wallet.',t,0.6,GOLD2,110)
        a=appear(t,0.9)
        wx0,wx1,wy0,wy1=300,780,1250,1520
        rr(dr,(wx0,wy0,wx1,wy1),50,fill=(32,25,14,int(255*a)),outline=GOLD+(int(255*a),),w=6)
        rr(dr,(wx1-150,wy0+90,wx1+10,wy0+180),40,fill=GOLD+(int(255*a),))
        dr.ellipse((wx1-65,wy0+122,wx1-35,wy0+152),fill=(30,20,2,int(255*a)))
        for k in range(5):
            tt=(t-1.0-k*0.22)/0.7
            if 0<tt<1:
                e=tt*tt
                coin(dr,W//2-80+(k%3)*60,900+e*(1250-900),40,min(1,(1-tt)*4+0.3))
    else:
        u=t-2.1
        title(dr,780,'Start mining',u,0.0,TXT,120)
        title(dr,930,'today.',u,0.25,GOLD2,140)
        a=appear(u,0.7)
        if a>0:
            pulse=1+0.03*math.sin(u*6)
            w,h=330*pulse,95*pulse
            rr(dr,(W//2-w,1200-h,W//2+w,1200+h),95,fill=GOLD+(int(255*a),))
            dr.text((W//2,1200),'Vertexhash',font=fit('Vertexhash',560,60),fill=(30,20,2,int(255*a)),anchor='mm')
    return im
SC=[(3.75,s1),(3.75,s2),(3.75,s3),(3.75,s4),(5.0,s5)]
total=sum(dur for dur,_ in SC);N=int(total*FPS)
p=subprocess.Popen(['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium','out.mp4'],stdin=subprocess.PIPE,stderr=open('ff.log','w'))
for n in range(N):
    T=n/FPS;acc=0
    for dur,fn in SC:
        if T<acc+dur or (dur,fn)==SC[-1]:
            t=T-acc;break
        acc+=dur
    im=fn(t)
    fade=min(1,t/0.35)
    if (dur,fn)!=SC[-1]:fade=min(fade,(dur-t)/0.35)
    fade=max(0,min(1,fade))
    if fade<1:
        al=im.getchannel('A').point(lambda v:int(v*fade));im.putalpha(al)
    fr=bg.copy();fr.paste(im,(0,0),im)
    p.stdin.write(fr.tobytes())
p.stdin.close();p.wait();print('done',N)
