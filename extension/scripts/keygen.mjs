// 확장 ID를 고정하려고 키를 한 번 만든다 (.keys/, 커밋하지 않는다).
// manifest.key(공개키)가 같으면 "압축해제된 확장 로드"로 어디서 불러도 확장 ID가 같다.
// native host 등록(install-host)은 이 ID 하나만 허용한다.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.keys');
const pub = path.join(dir, 'public.b64');

export function extensionId(publicB64) {
  const hash = createHash('sha256').update(Buffer.from(publicB64, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

if (!existsSync(pub)) {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(pub, publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
}
const id = extensionId(readFileSync(pub, 'utf8').trim());
writeFileSync(path.join(dir, 'extension-id.txt'), id);
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) console.log(`확장 ID: ${id}`);
