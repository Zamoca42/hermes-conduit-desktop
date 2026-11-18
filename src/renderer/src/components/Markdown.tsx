import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

/** A reply's markdown. Raw HTML in it stays text; links open in the browser. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  )
})
