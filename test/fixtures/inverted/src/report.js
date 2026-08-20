// report 模块：代码已成规模，上游规格却还缺着 —— 这就是倒挂。
export function reportHandler(input) {
  if (!input) throw new Error('input 不能为空');
  return { module: 'report', ok: true };
}
