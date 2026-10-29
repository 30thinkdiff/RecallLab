import { promptProblem } from '../domain/readiness';
// A conservative content warning, not a guarantee of prompt-injection detection.
export function candidateQualityProblem(question: string, answer: string, quote: string) {
  const existing = promptProblem({ question, standardAnswer: answer });
  if (existing) return existing;
  if (
    /伪系统指令|忽略(?:前面|以上|先前).{0,8}规则|(?:读取|上传|发送).{0,16}(?:密码文件|密钥)|删除学习历史/iu.test(
      `${question}\n${quote}`,
    )
  )
    return '题干或引用含操作指令，不能直接用作学习内容。请选取真正的知识原文并改写题干。';
  if (
    /可能|通常|有时|在.{0,15}(?:条件|情况下)|may\b|might\b|usually\b/iu.test(quote) &&
    !/可能|通常|有时|条件|情况下|无法确定|不能断言|不一定|may\b|might\b|usually\b|not necessarily/iu.test(
      answer,
    )
  )
    return '答案丢失了原文的不确定性或条件，请核对后保留限定。';
  if (
    /不等于|不代表|不能|不会|不得|does not|cannot/iu.test(quote) &&
    /^(?:是|可以|会|必然|一定|yes|always)[。.!！]?$/iu.test(answer.trim())
  )
    return '答案与原文的否定或限制可能矛盾，请核对。';
  const compact = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
  const q = compact(question),
    a = compact(answer);
  if (
    q.length >= 8 &&
    a.startsWith(q) &&
    !/[？?]|什么|哪些|为何|为什么|如何|怎样|说明|比较|解释|请/u.test(question)
  )
    return '题干直接复制了答案开头，请改为具体的回忆问题。';
  return null;
}
