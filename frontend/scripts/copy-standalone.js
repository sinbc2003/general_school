// 빌드 후 standalone 출력에 정적 자산을 복사한다.
// Next.js output:'standalone'은 .next/static 과 public 을 standalone 디렉토리로
// 자동 복사하지 않으므로 이 단계가 없으면 정적 자산(css/js chunk)이 404가 된다.
//
// build 스크립트에 묶어 두어, 어떤 배포 경로(setup-production / 수동 / 자동 업데이트)든
// `npm run build`만 하면 자동으로 적용되도록 한다. cross-platform(node fs)이라 OS 무관.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.log("[copy-standalone] .next/standalone 없음 (output:'standalone' 빌드가 아님) — skip");
  process.exit(0);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  return true;
}

if (copyDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"))) {
  console.log("[copy-standalone] .next/static -> standalone 복사 완료");
}
if (copyDir(path.join(root, "public"), path.join(standalone, "public"))) {
  console.log("[copy-standalone] public -> standalone 복사 완료");
}
