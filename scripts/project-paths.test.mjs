import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjectPath } from "../src/lib/projectPaths.ts";

test("루트 폴더 선택 시 절대경로를 유지한다", () => {
  for (const root of ["C:\\", "D:/", "/", "\\"]) {
    assert.equal(normalizeProjectPath(root), root);
  }
});

test("일반 폴더와 UNC 공유 경로의 끝 구분자만 정리한다", () => {
  assert.equal(normalizeProjectPath(" C:\\repo\\ "), "C:\\repo");
  assert.equal(normalizeProjectPath("/home/user/"), "/home/user");
  assert.equal(normalizeProjectPath("\\\\server\\share\\"), "\\\\server\\share");
  assert.equal(normalizeProjectPath(""), "");
});
