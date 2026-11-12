// 规格对规格：把两侧的 spec.json 按角色配对，输出差值
// 用法：node compare-spec.mjs <ref.json> <impl.json> [--tol 1]
import { readFileSync } from 'node:fs';
import { pairSpecs } from './probe/spec.mjs';

const [refPath, implPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tolIdx = process.argv.indexOf('--tol');
const tol = tolIdx > -1 ? parseFloat(process.argv[tolIdx + 1]) : 1;

const load = (p) => JSON.parse(readFileSync(p, 'utf8')).nodes;
const pairs = pairSpecs(load(refPath), load(implPath), tol);

const bad = pairs.filter((p) => !p.matched || p.drift);
for (const p of bad) {
  if (!p.matched) console.log(`${p.side === 'ref-only' ? 'REF-ONLY' : 'IMPL-ONLY'}  ${p.role}#${p.index}  ${p.text || ''}`);
  else console.log(`DRIFT  ${p.role}#${p.index}  dx ${p.dx} dy ${p.dy} dw ${p.dw} dh ${p.dh}   ${p.text || ''}`);
}

const matched = pairs.filter((p) => p.matched).length;
const unpaired = pairs.length - matched;
const drift = pairs.filter((p) => p.matched && p.drift).length;
console.log(`\n配对 ${matched} | 漂移 ${drift} | 未配对 ${unpaired}（${((unpaired / (pairs.length || 1)) * 100).toFixed(1)}%）`);
console.log(drift === 0 && unpaired === 0 ? 'SPEC MATCH' : 'SPEC MISMATCH');
