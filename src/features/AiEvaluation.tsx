import corpus from '../../evaluation/v052/corpus.json';
import report from '../../evaluation/v052/results.json';
import costs from '../../evaluation/v052/cost-results.json';
const names: Record<string, string> = {
  deterministic: 'A · 规则提取',
  standard: 'B · 1.5B 原有提示',
  units: 'C · 1.5B 分知识整理',
};
const methods: Record<string, string> = {
  manual: '手工创建',
  rule: '规则导入/选文后编辑',
  ai: 'AI 辅助后确认',
};
const verdicts: Record<string, string> = {
  ready: '未建议改题',
  edit: '建议改题',
  reject: '当前题干不可直接用',
};
export function AiEvaluation() {
  return (
    <>
      <h1>本地模型效果评测</h1>
      <p className="page-intro">
        24 份公开虚构材料，覆盖中文、英文、长答案、易混概念、OCR
        错字、无结论文章及伪指令。参考清单和逐条审阅由 AI
        工程执行者编写，尚无独立真人金标准；允许多个合理问题。
      </p>
      <p>
        复用已有 {report.environment.model} · CPU / 2 线程 /
        Q4_K_M，未下载新模型。原有提示需生成整套内容；分知识方案只让模型建议题干，答案和评分要点由原文规则准备。两者的工作量不同，不能把生成耗时直接解释成用户提效。
      </p>
      <p className="info-note">
        来源文字存在不等于语义正确。改进方案保留了本组全部 74 项参考内容，但仍有 13
        个题干被工程审阅建议修改；没有自动确认。独立真人合理率、真实用户确认率和人工准备时间均未测量。
      </p>
      <div className="table-scroll">
        <table>
          <caption>程序检查：恢复服务后的完整有效批次；早期超时和中断记录仍保留在工程报告</caption>
          <thead>
            <tr>
              <th>方案</th>
              <th>完成材料</th>
              <th>候选数</th>
              <th>引用定位</th>
              <th>答案字面要点</th>
              <th>评分字面要点</th>
              <th>题干规则告警</th>
              <th>生成用时</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((r) => (
              <tr key={r.strategy}>
                <th>{names[r.strategy]}</th>
                <td>
                  {r.completed}/{r.cases}
                </td>
                <td>{r.candidates}</td>
                <td>
                  {r.sourceMatched}/{r.candidates}
                </td>
                <td>
                  {r.answerLiteralCovered}/{r.referencePoints}
                </td>
                <td>
                  {r.rubricLiteralCovered}/{r.referencePoints}
                </td>
                <td>{r.promptWarnings}</td>
                <td>{(r.elapsedMs / 1000).toFixed(1)} 秒</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        字面包含会漏掉合理译述，也不能判断意思是否正确。C
        的高覆盖来自保留原文，不代表模型理解了全部知识。A 只为 5 份有明确结构的材料提供 10
        条候选；没有结构时保留人工流程。
      </p>
      <div className="table-scroll">
        <table>
          <caption>AI 工程逐条审阅建议，非独立真人判定、非用户已确认结果</caption>
          <thead>
            <tr>
              <th>方案</th>
              <th>未建议改题</th>
              <th>建议改题</th>
              <th>建议改答案</th>
              <th>建议改要点</th>
              <th>重复超额</th>
              <th>未提出必须改动</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((r) => (
              <tr key={r.strategy}>
                <th>{names[r.strategy]}</th>
                <td>
                  {r.engineering.readyQuestions}/{r.candidates}
                </td>
                <td>{r.engineering.suggestedQuestionChanges}</td>
                <td>{r.engineering.suggestedAnswerChanges}</td>
                <td>{r.engineering.suggestedRubricChanges}</td>
                <td>{r.engineering.duplicateExcess}</td>
                <td>{r.engineering.noRequiredEditsSuggested}（仍需你确认）</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        按当前完整单元的评分范围保守审阅，建议修改不等于每个窄问题都错误；标题式闪卡、合理拆题及其他表达可能适合不同任务。字段修改数不是实测人工操作数。简单短题仍可使用原有简洁核对，无需强制添加详细要点。
      </p>
      <details>
        <summary>仍未解决的问题与试验边界</summary>
        <ul>
          <li>提问可能偏窄、要求原文没有说明的方法或目的；原文完整并不能弥补题干不合适。</li>
          <li>关键词与理解目标虽然传入不同指令，本组实际输出仍未可靠地区分记忆与解释型问题。</li>
          <li>重复题会提示比较及跳过；OCR 文字和要点必要性仍须对照来源核对。</li>
          <li>参考集也用于改进提示及规则，没有独立留出集，不能推断其他教材上的普遍效果。</li>
          <li>
            温度固定为 0，重复运行仍有少量措辞变化；最终 C 使用最新完整一轮，未逐例挑选最好输出。
          </li>
        </ul>
      </details>
      <h2>实际操作对照</h2>
      <p>
        下面是自动化脚本操作，不是真人体验耗时。包含两份明确问答材料和一份普通教材段落；AI
        调用了本机真实模型。排除建项目、编写材料、阅读和思考；题干统一到固定参考表述，会多算一些本来不必做的编辑。手工创建也未自动保留文档位置，能力并不完全相同。
      </p>
      <div className="table-scroll">
        <table>
          <caption>脚本净界面耗时包含模型等待，不代表人的准备时间</caption>
          <thead>
            <tr>
              <th>材料</th>
              <th>方式</th>
              <th>逻辑操作数</th>
              <th>脚本填写字符</th>
              <th>脚本耗时</th>
              <th>其中模型等待</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((r) => (
              <tr key={`${r.taskId}/${r.method}`}>
                <th>{corpus.cases.find((c) => c.id === r.taskId)?.category}</th>
                <td>{methods[r.method]}</td>
                <td>
                  {Object.entries(r.counts)
                    .filter(([k]) => k !== 'typedCharacters')
                    .reduce((n, [, v]) => n + v, 0)}
                </td>
                <td>{r.counts.typedCharacters}</td>
                <td>{(r.elapsedMs / 1000).toFixed(2)} 秒</td>
                <td>{(r.modelMs / 1000).toFixed(2)} 秒</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        本组 AI
        减少了填写的文字，但操作更多、等待更久，尚未证明真实用户总制卡成本下降。填写字符按脚本字符串长度计，不是物理按键数。公开
        CI 仅重放已记录的真实响应验证交互，不把重放当成新的模型效果测试。
      </p>
      <h2>逐份来源与失败记录</h2>
      {corpus.cases.map((fixture) => (
        <details className="question-panel" key={fixture.id}>
          <summary>{fixture.category}</summary>
          <h3>原始资料</h3>
          <pre className="ai-original">{fixture.text}</pre>
          <h3>参考必要内容（工程编写，允许合理拆分及多种问法）</h3>
          {fixture.units.map((unit) => (
            <section key={unit.id}>
              <strong>{unit.topic}</strong>
              <ul>
                {unit.required.map((p) => (
                  <li key={p.point}>{p.point}</li>
                ))}
              </ul>
              <p>问题示例：{unit.acceptableQuestions.join(' / ')}</p>
              {unit.optionalExamples.length > 0 && (
                <p>可选例子：{unit.optionalExamples.join(' / ')}</p>
              )}
            </section>
          ))}
          {fixture.notForCards.map((n) => (
            <p key={n.reason}>{n.reason}</p>
          ))}
          {report.runs
            .filter((r) => r.caseId === fixture.id)
            .map((run) => (
              <section key={run.strategy}>
                <h3>
                  {names[run.strategy]} · {run.rows.length} 条 · {(run.elapsedMs / 1000).toFixed(1)}{' '}
                  秒
                </h3>
                <p>{run.engineeringReview.note}</p>
                {run.rows.length === 0 && <p>没有候选，保留原文和人工整理流程。</p>}
                {run.rows.map((c, i) => (
                  <div className="ai-candidate" key={i}>
                    <p>
                      <strong>候选题干：</strong>
                      {c.question}
                    </p>
                    <p className="preserve-lines">
                      <strong>候选答案：</strong>
                      {c.answer || '（没有答案，不能直接制卡）'}
                    </p>
                    <p className="preserve-lines">
                      <strong>引用：</strong>
                      {c.quote}
                    </p>
                    <p>
                      工程题干审阅：{verdicts[run.engineeringReview.rows[i]!.questionVerdict]}
                      {run.engineeringReview.rows[i]!.duplicate ? '；重复，建议跳过' : ''}
                      。原文定位：{c.sourceMatched ? '找到文字' : '未唯一定位'}，仍不证明语义正确。
                    </p>
                    {run.strategy === 'units' && (
                      <p className="muted">
                        本方案答案和以下要点由原文规则准备，模型原始输出只有题干。
                      </p>
                    )}
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
