-- 演示数据：给别人演示前跑一次就有一批看得过去的假数据。
-- 姓名、电话、单号全是编的，不含任何真实客户信息。
INSERT INTO customers (id, name, phone) VALUES
  (1, '示例商贸', '13800000001'),
  (2, '样板五金', '13800000002');
INSERT INTO orders (id, customer_id, amount, status) VALUES
  (1001, 1, 1280.00, 'paid'),
  (1002, 2, 640.00, 'pending');
