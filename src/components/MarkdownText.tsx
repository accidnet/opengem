import type { ElementType, ReactNode } from "react";

type MarkdownTextProps = {
  text: string;
  className?: string;
};

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "code"; text: string }
  | { type: "paragraph"; text: string };

const ORDERED_LIST_PATTERN = /^(\d+)\.\s+(.*)$/;
const UNORDERED_LIST_PATTERN = /^[-*+]\s+(.*)$/;

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      nodes.push(
        <a
          key={`${match.index}-link`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="bubble-link"
        >
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(
        <code key={`${match.index}-code`} className="bubble-inline-code">
          {match[5]}
        </code>
      );
    } else if (match[6] || match[8]) {
      nodes.push(<strong key={`${match.index}-strong`}>{match[7] ?? match[9]}</strong>);
    } else if (match[10] || match[12]) {
      nodes.push(<em key={`${match.index}-em`}>{match[11] ?? match[13]}</em>);
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];

      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const unorderedMatch = trimmed.match(UNORDERED_LIST_PATTERN);
    if (unorderedMatch) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim().match(UNORDERED_LIST_PATTERN);
        if (!current) {
          break;
        }
        items.push(current[1]);
        index += 1;
      }

      blocks.push({ type: "unordered-list", items });
      continue;
    }

    const orderedMatch = trimmed.match(ORDERED_LIST_PATTERN);
    if (orderedMatch) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim().match(ORDERED_LIST_PATTERN);
        if (!current) {
          break;
        }
        items.push(current[2]);
        index += 1;
      }

      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;

    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        next.startsWith("```") ||
        next.startsWith(">") ||
        /^#{1,6}\s+/.test(next) ||
        UNORDERED_LIST_PATTERN.test(next) ||
        ORDERED_LIST_PATTERN.test(next)
      ) {
        break;
      }

      paragraphLines.push(next);
      index += 1;
    }

    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function renderParagraph(text: string) {
  const lines = text.split("\n");

  return lines.map((line, index) => (
    <span key={`line-${index}`}>
      {parseInline(line)}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

export function MarkdownText({ text, className }: MarkdownTextProps) {
  const blocks = parseBlocks(text);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;

        switch (block.type) {
          case "heading": {
            const HeadingTag = `h${block.level}` as ElementType;
            return <HeadingTag key={key}>{parseInline(block.text)}</HeadingTag>;
          }
          case "blockquote":
            return <blockquote key={key}>{renderParagraph(block.text)}</blockquote>;
          case "unordered-list":
            return (
              <ul key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{parseInline(item)}</li>
                ))}
              </ul>
            );
          case "ordered-list":
            return (
              <ol key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{parseInline(item)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="bubble-code-block">
                <code>{block.text}</code>
              </pre>
            );
          case "paragraph":
            return <p key={key}>{renderParagraph(block.text)}</p>;
          default:
            return null;
        }
      })}
    </div>
  );
}
