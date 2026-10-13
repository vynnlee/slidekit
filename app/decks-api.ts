import { join } from "node:path";

const root = join(import.meta.dir, "..");

// 새 덱: engine/new.ts(slidekit new)를 그대로 실행해 규칙(이름 형식, 중복 거부)을 한 곳에 둔다.
export async function createDeck(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return Response.json({ error: "Use lowercase letters, digits and - only" }, { status: 400 });
  const p = Bun.spawn(["bun", join(root, "engine", "new.ts"), name], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) return Response.json({ error: "Name already exists" }, { status: 409 });
  return Response.json({ id: name }, { status: 201 });
}
