import assert from "node:assert/strict";
import test from "node:test";
import { getPermittedToolCalls } from "../src/features/chat/toolPolicy.ts";

const call = (name) => ({ id: "call-1", name, arguments: "{}" });
const definition = (name) => ({
  type: "function",
  function: { name, description: "test", parameters: { type: "object" } },
});

test("Google 읽기 등 도구 없는 턴에서는 공급자가 반환한 셸 호출도 거절한다", () => {
  assert.throws(() => getPermittedToolCalls([call("shell_command")], []), /허용하지 않은/);
  assert.deepEqual(getPermittedToolCalls(undefined, []), []);
});
test("이번 턴에 제공한 도구만 허용하고 섞인 미허용 호출은 일괄 거절한다", () => {
  const tools = [definition("workspace_read_file")];
  assert.deepEqual(getPermittedToolCalls([call("workspace_read_file")], tools), [
    call("workspace_read_file"),
  ]);
  assert.throws(
    () => getPermittedToolCalls([call("workspace_read_file"), call("shell_command")], tools),
    /허용하지 않은/
  );
  assert.throws(
    () => getPermittedToolCalls([call("workspace_read_file ")], tools),
    /허용하지 않은/
  );
});
test("이름이 없는 불완전한 스트리밍 도구 호출은 실행하지 않는다", () => {
  assert.deepEqual(getPermittedToolCalls([call(""), call("  ")], []), []);
});
