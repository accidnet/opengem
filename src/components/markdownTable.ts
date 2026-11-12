type TableAlignment = "left" | "center" | "right";

type MarkdownTable = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
  nextIndex: number;
};

function splitRow(source: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const line = source.trim();
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  if (line.startsWith("|")) cells.shift();
  if (line.endsWith("|") && !line.endsWith("\\|")) cells.pop();
  return cells;
}

// 구분 행이 있는 표만 인식하여 일반 문장의 파이프와 코드 블록을 보존합니다.
export function parseMarkdownTable(lines: string[], start: number): MarkdownTable | null {
  const header = lines[start];
  const separator = lines[start + 1];
  if (!header?.includes("|") || !separator) return null;
  const headers = splitRow(header);
  const separators = splitRow(separator);
  if (
    !headers.length ||
    headers.length !== separators.length ||
    !separators.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
    return null;
  const alignments: TableAlignment[] = separators.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"
  );
  const rows: string[][] = [];
  let nextIndex = start + 2;
  while (nextIndex < lines.length && lines[nextIndex].trim() && lines[nextIndex].includes("|")) {
    const cells = splitRow(lines[nextIndex]);
    rows.push(headers.map((_, index) => cells[index] ?? ""));
    nextIndex += 1;
  }
  return { headers, rows, alignments, nextIndex };
}
