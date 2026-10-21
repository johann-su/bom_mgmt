import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// react-markdown passes its AST `node` along; it mustn't reach the DOM.
function styled<T extends keyof React.JSX.IntrinsicElements>(Tag: T, className: string, extra?: object) {
  function Styled({ node, ...props }: React.ComponentProps<T> & { node?: unknown }) {
    void node;
    const Element = Tag as React.ElementType;
    return <Element className={className} {...extra} {...props} />;
  }
  return Styled;
}

// Element styles for rendered Markdown (there's no typography plugin). Sized
// for a card body: headings stay small, spacing comes from the wrapper.
const COMPONENTS: Components = {
  h1: styled("h3", "text-base font-semibold"),
  h2: styled("h3", "text-base font-semibold"),
  h3: styled("h4", "font-semibold"),
  h4: styled("h5", "font-semibold"),
  ul: styled("ul", "list-disc pl-5 space-y-1"),
  ol: styled("ol", "list-decimal pl-5 space-y-1"),
  a: styled("a", "underline underline-offset-2", { target: "_blank", rel: "noopener noreferrer" }),
  hr: styled("hr", "border-border"),
  blockquote: styled("blockquote", "border-l-2 pl-3 text-muted-foreground"),
  code: styled("code", "rounded bg-muted px-1 font-mono text-xs"),
  pre: styled("pre", "overflow-x-auto rounded bg-muted p-3 text-xs"),
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left" {...props} />
      </div>
    );
  },
  th: styled("th", "border-b px-2 py-1 font-medium"),
  td: styled("td", "border-b px-2 py-1 align-top"),
};

// Renders user/shop-supplied Markdown. Raw HTML in the source is shown as
// text, not rendered, and react-markdown drops javascript: links — safe for
// descriptions copied from arbitrary shop pages. Single newlines are line
// breaks, matching how text was typed into the textarea.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("grid gap-3 text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
