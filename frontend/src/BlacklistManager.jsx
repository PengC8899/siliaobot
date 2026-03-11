import React, { useState, useEffect } from "react";
import { Table, Button, Input, Modal, message, Card } from "antd";
import { getBlacklist, addToBlacklist, removeFromBlacklist } from "./api";

const BlacklistManager = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({ username: "", reason: "" });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getBlacklist();
      setItems(res.items);
    } catch (e) {
      message.error("加载黑名单失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = async () => {
    if (!form.username) return;
    try {
      await addToBlacklist(form.username, form.reason);
      message.success("已添加到黑名单");
      setIsModalOpen(false);
      setForm({ username: "", reason: "" });
      loadData();
    } catch (e) {
      message.error("添加失败: " + e.message);
    }
  };

  const handleRemove = async (username) => {
    try {
      await removeFromBlacklist(username);
      message.success("已从黑名单移除");
      loadData();
    } catch (e) {
      message.error("移除失败");
    }
  };

  const columns = [
    { title: "用户名", dataIndex: "username", key: "username" },
    { title: "原因", dataIndex: "reason", key: "reason" },
    { title: "添加时间", dataIndex: "created_at", key: "created_at" },
    {
      title: "操作",
      key: "action",
      render: (_, record) => (
        <Button danger onClick={() => handleRemove(record.username)}>
          移除
        </Button>
      ),
    },
  ];

  return (
    <Card title="黑名单管理" extra={<Button type="primary" onClick={() => setIsModalOpen(true)}>添加用户</Button>}>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} />
      
      <Modal title="添加到黑名单" open={isModalOpen} onOk={handleAdd} onCancel={() => setIsModalOpen(false)}>
        <Input 
          placeholder="用户名 (例如 @spammer)" 
          value={form.username} 
          onChange={(e) => setForm({ ...form, username: e.target.value })} 
          style={{ marginBottom: 10 }}
        />
        <Input 
          placeholder="原因" 
          value={form.reason} 
          onChange={(e) => setForm({ ...form, reason: e.target.value })} 
        />
      </Modal>
    </Card>
  );
};

export default BlacklistManager;
