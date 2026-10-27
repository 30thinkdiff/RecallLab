import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { format } from 'prettier';
const root = new URL('../tests/fixtures/import/', import.meta.url);
const options = JSON.parse(await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8'));
const items = Array.from({ length: 69 }, (_, i) => ({
  question: `虚构导入题 ${String(i + 1).padStart(2, '0')}：蓝晶协议是什么？`,
  answer: `虚构标准答案 ${i + 1}：包含中文、Unicode 🙂、逗号,和"引号"。\n第二要点：原文保持不变。`,
  hints: ['虚构提示一', '虚构提示二'],
  answerCriteria: ['第一要点', '第二要点'],
}));
const files = {
  'bank-69.json': await format(
    JSON.stringify({ format: 'RecallLabQuestionBank', version: 1, items }),
    { ...options, parser: 'json' },
  ),
  'sample.csv':
    'question,answer\r\n"虚构逗号,问题","第一行,中文🙂\n第二行含""引号"""\r\n"第二个问题","第二个答案"\r\n',
  'sample.tsv': '问题\t答案\n虚构制表问题\t"第一行\n第二行🙂"\n',
  'sample.txt':
    '第一章 虚构资料\n问：虚构甲是什么？\n答：第一要点\n第二要点\n\n问：虚构乙是什么？\n答：另一答案\n',
  'sample.md':
    '# 虚构章节\nQ: Markdown 虚构问题\nA: 多行答案第一点\n第二点🙂\n\n## 虚构对比\n问：相似问题如何区分？\n答：以原文为准。\n',
  'prose.txt':
    '第一章 普通虚构讲义\n这是一段没有明确问答结构的文字。\n用户需要自行选择原文并填写问题。\n',
};
if (!process.argv.includes('--check')) await mkdir(root, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = new URL(name, root);
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')) !== content)
      throw new Error(`Import fixture differs: ${name}`);
  } else await writeFile(path, content);
}
