import React, { useState, useEffect } from "react";
import { Table, Button, Input, Modal, message, Card, Tag } from "antd";
import { getProxies, addProxies, removeProxy } from "./api";

const { TextArea } = Input;

const ProxyManager = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [urls, setUrls] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getProxies();
      setItems(res.items);
    } catch (e) {
      message.error("加载代理失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = async () => {
    if (!urls) return;
    const urlList = urls.split("\n").map(u => u.trim()).filter(u => u);
    try {
      await addProxies(urlList);
      message.success("代理已添加");
      setIsModalOpen(false);
      setUrls("");
      loadData();
    } catch (e) {
      message.error("添加失败: " + e.message);
    }
  };

  const handleRemove = async (id) => {
    try {
      await removeProxy(id);
      message.success("已移除代理");
      loadData();
    } catch (e) {
      message.error("移除失败");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", key: "id" },
    { title: "地址", dataIndex: "url", key: "url", ellipsis: true },
    { 
      title: "状态", 
      dataIndex: "status", 
      key: "status",
      render: status => <Tag color={status === 'active' ? 'green' : 'red'}>{status === 'active' ? '正常' : '失效'}</Tag>
    },
    { title: "失败次数", dataIndex: "fail_count", key: "fail_count" },
    { title: "上次使用", dataIndex: "last_used", key: "last_used" },
    {
      title: "操作",
      key: "action",
      render: (_, record) => (
        <Button danger size="small" onClick={() => handleRemove(record.id)}>
          移除
        </Button>
      ),
    },
  ];

  return (
    <Card title="代理池" extra={<Button type="primary" onClick={() => setIsModalOpen(true)}>添加代理</Button>}>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} />
      
      <Modal title="添加代理" open={isModalOpen} onOk={handleAdd} onCancel={() => setIsModalOpen(false)}>
        <p>输入代理地址 (每行一个):</p>
        <p>格式: socks5://user:pass@host:port 或 http://...</p>
        <TextArea 
          rows={10} 
          placeholder="socks5://user:pass@1.2.3.4:1080" 
          value={urls} 
          onChange={(e) => setUrls(e.target.value)} 
        />
      </Modal>
    </Card>
  );
};

export default ProxyManager;
