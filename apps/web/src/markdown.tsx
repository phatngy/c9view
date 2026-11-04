import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({
  text,
  demoteHeadings = false,
}: {
  text: string;
  demoteHeadings?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...(demoteHeadings
            ? ({
                h1: ({ children }) => <h2>{children}</h2>,
                h2: ({ children }) => <h3>{children}</h3>,
                h3: ({ children }) => <h4>{children}</h4>,
                h4: ({ children }) => <h5>{children}</h5>,
                h5: ({ children }) => <h6>{children}</h6>,
                h6: ({ children }) => <h6>{children}</h6>,
              } satisfies Components)
            : {}),
          img: ({ alt, src }) => (
            <span className="text-muted">[image: {alt || src || 'image'}]</span>
          ),
          a: ({ href, children }) => (
            <a href={href} rel="noreferrer noopener" target="_blank">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
