import fs from 'node:fs';

const path = 'C:/perry/games/tower_game/index.html';
let html = fs.readFileSync(path, 'utf8');

// Strip GTM
html = html.replace(/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]+"><\/script>/g, '');
html = html.replace(/<script>function gtag\(\)\{dataLayer\.push\(arguments\)\}[^<]*<\/script>/g, '');

const bootShim = `<script>(function(){
var orig=window.getComputedStyle;
window.getComputedStyle=function(el,pseudo){
  if(!el||el.nodeType!==1){
    return {getPropertyValue:function(){return '';},getProperty:function(){return '';}};
  }
  try{
    if(pseudo==null||pseudo==='') return orig.call(window,el);
    return orig.call(window,el,pseudo);
  }catch(e){
    try{return orig.call(window,el);}catch(e2){
      return {getPropertyValue:function(){return '';},getProperty:function(){return '';}};
    }
  }
};
var drawProto=CanvasRenderingContext2D.prototype;
var origDraw=drawProto.drawImage;
drawProto.drawImage=function(img){
  try{
    if(!img) return;
    return origDraw.apply(this,arguments);
  }catch(e){ /* ignore broken/missing bitmap */ }
};
})();</script>`;

const zeptoPatch = `<script>(function(){
function safeCS(el){try{if(!el||el.nodeType!==1)return null;return window.getComputedStyle(el);}catch(e){return null;}}
function defaultDisplay(name){
  try{
    var e=document.createElement(name||'div');
    document.body.appendChild(e);
    var d=safeCS(e);
    var n=d?d.getPropertyValue('display'):'';
    e.parentNode&&e.parentNode.removeChild(e);
    return (!n||n==='none')?'block':n;
  }catch(e){return 'block';}
}
function patch($){
  if(!$||!$.fn) return;
  $.fn.show=function(){
    return this.each(function(){
      try{
        if(!this||this.nodeType!==1) return;
        if(this.style&&this.style.display==='none') this.style.display='';
        var cs=safeCS(this);
        if(cs&&cs.getPropertyValue('display')==='none'){
          this.style.display=defaultDisplay(this.nodeName);
        }
      }catch(e){}
    });
  };
  $.fn.hide=function(){
    return this.each(function(){
      try{ if(this&&this.style) this.style.display='none'; }catch(e){}
    });
  };
}
if(window.Zepto) patch(window.Zepto);
if(window.$ && window.$.fn) patch(window.$);
})();</script>`;

// Insert boot shim immediately after <body>
if (!html.includes('window.getComputedStyle=function(el,pseudo)')) {
  html = html.replace(/<body>/i, '<body>' + bootShim);
}

// Patch Zepto right after it loads
if (!html.includes('function safeCS(el)')) {
  html = html.replace(
    '<script src="./assets/zepto-1.1.6.min.js"></script>',
    '<script src="./assets/zepto-1.1.6.min.js"></script>' + zeptoPatch
  );
}

fs.writeFileSync(path, html);
console.log('ok');
console.log('gtag', html.includes('googletagmanager'));
console.log('shim', html.includes('window.getComputedStyle=function(el,pseudo)'));
console.log('zeptoPatch', html.includes('function safeCS(el)'));
