import fs from 'node:fs';

function patchFile(path, pairs) {
  let s = fs.readFileSync(path, 'utf8');
  let changed = false;
  for (const [from, to] of pairs) {
    if (s.includes(to)) {
      console.log('already', path, from.slice(0, 40));
      continue;
    }
    if (!s.includes(from)) {
      console.log('MISS', path, from.slice(0, 60));
      continue;
    }
    s = s.split(from).join(to);
    changed = true;
    console.log('patched', path, from.slice(0, 50));
  }
  if (changed) fs.writeFileSync(path, s);
}

const safeAttach =
  'document.getElementById(\'canvas-container\').appendChild(renderer.domElement);';
const safeAttachNew =
  '(function(){var cc=document.getElementById(\'canvas-container\');if(!cc){cc=document.createElement(\'div\');cc.id=\'canvas-container\';cc.setAttribute(\'data-visual-staging\',\'1\');cc.style.cssText=\'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none\';(document.body||document.documentElement).appendChild(cc);}if(cc&&renderer&&renderer.domElement)cc.appendChild(renderer.domElement);})();';

const safeAttach2 =
  "document.getElementById('canvas-container').appendChild(renderer.domElement);";
const safeAttach2New =
  "(function(){var cc=document.getElementById('canvas-container');if(!cc){cc=document.createElement('div');cc.id='canvas-container';cc.setAttribute('data-visual-staging','1');cc.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';(document.body||document.documentElement).appendChild(cc);}if(cc&&renderer&&renderer.domElement)cc.appendChild(renderer.domElement);})();";

// mineradio-bundle uses double-quoted style in one place - try both quote styles
patchFile('C:/perry/client/public/visual/mineradio-bundle.js', [
  ["document.getElementById('canvas-container').appendChild(renderer.domElement);", safeAttach2New],
  ['document.getElementById(\'canvas-container\').appendChild(renderer.domElement);', safeAttachNew],
  ['document.getElementById("canvas-container").appendChild(renderer.domElement);', safeAttach2New.replace(/'/g, '"') ],
]);

patchFile('C:/perry/client/public/visual/js/modules/01-scene/00-renderer-quality.js', [
  ["document.getElementById('canvas-container').appendChild(renderer.domElement);", safeAttach2New],
  ["document.getElementById('canvas-container').appendChild(renderer.domElement);", safeAttach2New],
]);

// keep source module in sync with double quotes if needed
patchFile('C:/perry/client/public/visual/js/modules/01-scene/00-renderer-quality.js', [
  ['document.getElementById("canvas-container").appendChild(renderer.domElement);', safeAttach2New.replace(/'/g, '"')],
]);

console.log('done');
