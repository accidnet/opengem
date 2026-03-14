import { IconBadge } from "@/components/IconBadge";

type ToolsSectionProps = {
  tools: string[];
};

export function ToolsSection({ tools }: ToolsSectionProps) {
  return (
    <section className="panel-block">
      <h3 className="section-title">Enabled Tools</h3>
      <div className="panel-list">
        {tools.map((tool) => (
          <div key={tool} className="tool-item">
            <IconBadge
              icon={
                tool === "웹 브라우저"
                  ? "public"
                  : tool === "Python Repl"
                    ? "terminal"
                    : "folder_open"
              }
            />
            <span className="tool-label">{tool}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
