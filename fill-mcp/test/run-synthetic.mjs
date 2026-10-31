// 확장 흉내 모드(CLF_SYNTHETIC=1)로 fixture 테스트를 다시 돌린다: 실제 마우스·키보드 없이 흉내 입력만으로 되는지.
import { spawnSync } from 'node:child_process';

const files = ['mui', 'careerlink', 'meritz', 'antd', 'ninehire', 'ats', 'limits', 'files', 'postcode', 'login'].map((f) => `test/${f}.test.ts`);
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: { ...process.env, CLF_SYNTHETIC: '1' },
});
process.exit(r.status ?? 1);
