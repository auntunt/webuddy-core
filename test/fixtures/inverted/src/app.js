// 已经开始写代码了，但 01-scope-card.md 还不存在 —— 这就是倒挂。
export function handleOrder(order) {
  if (!order || !order.id) throw new Error('order 缺 id');
  return { ok: true, id: order.id };
}
