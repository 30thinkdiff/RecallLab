import corpus from '../../evaluation/cases.json';
import report from '../../evaluation/results.json';
const names: Record<string, string> = {
  deterministic: '规则提取',
  standard: '1.5B 逐字引用',
  anchored: '1.5B 片段引用（试验）',
};
export function AiEvaluation() {
  return (
    <>
      <h1>本地模型效果评测</h1>
      <p className="page-intro">
        固定的 10 份公开虚构材料，包含中文、英文、长答案、相似概念、OCR
        错字、不完整与恶意指令数据。每方案各运行一次，保留所有结果，包括失败和低质量候选。
      </p>
      <p>
        实测模型：{report.environment.model} · CPU / 2 线程 /
        Q4_K_M。复用已有权重，没有下载新模型。实测时间：{new Date(report.at).toLocaleString()}。
      </p>
      <p className="info-note">
        当前小模型仍会遗漏必要内容、生成含答案的题干，甚至给不确定的内容下肯定结论。片段引用改善了本组文字定位，但没有证明语义质量更好。请优先使用明确编号资料的规则导入，AI
        建议必须核对。
      </p>
      <div className="table-scroll">
        <table>
          <caption>程序检查结果；引用存在不等于答案正确</caption>
          <thead>
            <tr>
              <th>方案</th>
              <th>输出结构完整</th>
              <th>候选数</th>
              <th>引用定位</th>
              <th>引用及要点定位合规</th>
              <th>题干规则警告</th>
              <th>总生成用时</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((row) => (
              <tr key={row.strategy}>
                <th>{names[row.strategy]}</th>
                <td>
                  {row.strategy === 'deterministic' ? '不适用' : `${row.completed}/${row.cases}`}
                </td>
                <td>{row.candidates}</td>
                <td>
                  {row.sourceMatched}/{row.candidates}
                </td>
                <td>
                  {row.citationAndRubricValid}/{row.candidates}
                </td>
                <td>{row.promptWarnings}</td>
                <td>{(row.elapsedMs / 1000).toFixed(1)} 秒</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        这不是正确率排行榜。只按完全相同题干统计的重复数不能发现语义重复；评分要点引用到整段原文，也不证明要点表达完整。各方案可用题目数、人工确认比例、修改量及每道可用题的准备时间尚未测量，不能由生成耗时推算。
      </p>
      <details>
        <summary>工程审阅发现的具体问题（AI 工程检查，非真实用户人工评测）</summary>
        <ul>
          <li>逐字方案把编号改错，引用被拒绝；长答案没有生成必需要点。</li>
          <li>片段方案的长答案引用较完整，但要点只有“第一、第二”等标签，仍需重写。</li>
          <li>不完整来源写着“可能适用”，片段方案却建议“是”；文字匹配不能证明这个答案受支持。</li>
          <li>
            恶意指令样例污染了题干或引用。模型无执行工具，系统未执行指令；现在规则会拦截已识别的操作指令，仍不能保证识别所有注入。
          </li>
        </ul>
      </details>
      <h2>逐份对照</h2>
      {corpus.map((fixture) => (
        <details className="question-panel" key={fixture.id}>
          <summary>{fixture.category}</summary>
          <h3>原始资料</h3>
          <pre className="ai-original">{fixture.text}</pre>
          <h3>预先编写的必要内容清单</h3>
          <ul>
            {fixture.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {report.runs
            .filter((run) => run.caseId === fixture.id)
            .map((run) => (
              <section key={run.strategy}>
                <h3>
                  {names[run.strategy]} · {run.candidates.length} 条 ·{' '}
                  {(run.elapsedMs / 1000).toFixed(1)} 秒
                </h3>
                {run.failures.map((f, i) => (
                  <p key={i}>{(f as { message: string }).message}</p>
                ))}
                {run.candidates.length === 0 && <p>没有自动候选，保留人工整理流程。</p>}
                {run.candidates.map((c, i) => (
                  <div className="ai-candidate" key={i}>
                    <p>
                      <strong>候选题干：</strong>
                      {c.question}
                    </p>
                    <p className="preserve-lines">
                      <strong>候选答案：</strong>
                      {c.answer}
                    </p>
                    <p className="preserve-lines">
                      <strong>引用：</strong>
                      {c.quote}
                    </p>
                    <p>
                      程序定位：{c.matched ? '文字存在' : '未唯一定位'}；要点引用：
                      {c.valid ? '通过定位检查，仍需核对语义' : '不合要求'}
                    </p>
                    <ul>
                      {c.criteria.map((point, j) => (
                        <li key={j}>
                          {point.text} · {point.required ? '建议必需' : '建议可选'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
        </details>
      ))}
      <a className="button secondary" href="#ai-drafts">
        返回 AI 整理草稿
      </a>
    </>
  );
}
