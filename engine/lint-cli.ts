// slidekit lint <덱>의 진입점(app/server.ts의 SUBS가 연다). 본체는 engine/lint.ts의 runCli다.
import { runCli } from "./lint";

await runCli(process.argv[2]);
