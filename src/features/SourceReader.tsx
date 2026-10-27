import { useState } from 'react';
import type { SourceDocument, SourceReference } from '../domain/models';
import type { MaterialDraft } from '../importing/types';

export function SourceReader({
  document,
  onSelect,
}: {
  document: SourceDocument | MaterialDraft;
  onSelect?: (source: SourceReference) => void;
}) {
  const [selected, setSelected] = useState<SourceReference | null>(null);
  return (
    <section className="source-reader">
      <h2>原文预览</h2>
      <p className="muted">
        以下为文件提取的原文，不会被编辑后的学习答案覆盖。选择文字后可创建问答。
      </p>
      {document.sections.length > 0 && (
        <details>
          <summary>章节（{document.sections.length}）</summary>
          <ul>
            {document.sections.map((section) => (
              <li key={section.id}>
                <a
                  className="text-link"
                  href={`#source-page-${document.id}-${section.page ?? 1}`}
                  onClick={(event) => {
                    event.preventDefault();
                    globalThis.document
                      .getElementById(`source-page-${document.id}-${section.page ?? 1}`)
                      ?.scrollIntoView({ block: 'center' });
                  }}
                >
                  {section.title}
                  {section.page ? ` · 第 ${section.page} 页` : ''}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {document.pages.map((page) => (
        <article
          className="source-page"
          id={`source-page-${document.id}-${page.number}`}
          key={page.number}
        >
          <h3>{document.fileType === 'pdf' ? `第 ${page.number} 页` : '原始文字'}</h3>
          {page.warnings.map((warning) => (
            <p className="info-note" key={warning}>
              {warning}
            </p>
          ))}
          <textarea
            aria-label={document.fileType === 'pdf' ? `第 ${page.number} 页原文` : '资料原文'}
            readOnly
            rows={Math.min(14, Math.max(4, page.text.split('\n').length))}
            value={page.text}
            onSelect={(event) => {
              const element = event.currentTarget;
              const start = element.selectionStart;
              const end = element.selectionEnd;
              if (start === end || page.status === 'failed') {
                setSelected(null);
                return;
              }
              const globalStart = page.startOffset + start;
              const section = [...document.sections]
                .reverse()
                .find(
                  (section) =>
                    globalStart >= section.startOffset && globalStart < section.endOffset,
                );
              setSelected({
                documentId: document.id,
                label: `${document.filename}${document.fileType === 'pdf' ? ` · 第 ${page.number} 页` : ''}`,
                startOffset: globalStart,
                endOffset: page.startOffset + end,
                excerpt: page.text.slice(start, end),
                ...(document.fileType === 'pdf' ? { page: page.number } : {}),
                ...(section ? { sectionId: section.id } : {}),
              });
            }}
          />
          {onSelect && (
            <button
              type="button"
              className="button secondary"
              disabled={!selected || (document.fileType === 'pdf' && selected.page !== page.number)}
              onClick={() => {
                if (selected) onSelect(selected);
              }}
            >
              用选中原文创建问答
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
