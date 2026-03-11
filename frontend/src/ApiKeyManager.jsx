import React, { useState, useEffect } from "react";
import { Table, Button, Input, Modal, message, Card, Tag } from "antd";
import { getApiKeys, addApiKeys, deleteApiKey, batchCheckApiKeys } from "./api";

const { TextArea } = Input;

const ApiKeyManager = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lines, setLines] = useState("");
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getApiKeys();
      setItems(res.items);
    } catch (e) {
      message.error("加载 API Key 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = async () => {
    if (!lines) return;
    try {
      await addApiKeys(lines);
      message.success("API Key 已添加");
      setIsModalOpen(false);
      setLines("");
      loadData();
    } catch (e) {
      message.error("添加失败: " + e.message);
    }
  };

  const handleRemove = async (id) => {
    try {
      await deleteApiKey(id);
      message.success("已移除");
      loadData();
    } catch (e) {
      message.error("移除失败");
    }
  };

  const handleBatchCheck = async () => {
    if (selectedRowKeys.length === 0) return message.warning("请选择要检测的 API Key");
    
    setLoading(true);
    try {
      message.loading({ content: "正在检测 API Key...", key: "check" });
      const res = await batchCheckApiKeys(selectedRowKeys);
      message.success({ content: "检测完成", key: "check" });
      loadData();
      setSelectedRowKeys([]);
    } catch (e) {
      message.error({ content: "检测失败: " + e.message, key: "check" });
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", key: "id" },
    { title: "API ID", dataIndex: "api_id", key: "api_id" },
    { title: "API Hash", dataIndex: "api_hash", key: "api_hash" },
    { 
      title: "描述/状态", 
      dataIndex: "description", 
      key: "description",
      render: (text) => {
        if (!text) return "-";
        if (text.includes("[VALID]")) return <Tag color="green">{text}</Tag>;
        if (text.includes("[INVALID]")) return <Tag color="red">{text}</Tag>;
        return <Tag>{text}</Tag>;
      }
    },
    { title: "添加时间", dataIndex: "created_at", key: "created_at" },
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
    <Card 
      title="API Key 管理 (轮询使用)" 
      extra={
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={handleBatchCheck} disabled={selectedRowKeys.length === 0}>
             批量检测
          </Button>
          <Button type="primary" onClick={() => setIsModalOpen(true)}>
             添加 API Key
          </Button>
        </div>
      }
    >
      <Table 
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        dataSource={items} 
        columns={columns} 
        rowKey="id" 
        loading={loading} 
        pagination={false}
      />
      
      <Modal title="添加 API Key" open={isModalOpen} onOk={handleAdd} onCancel={() => setIsModalOpen(false)}>
        <p>输入 API ID 和 Hash (每行一个):</p>
        <p>格式: 123456:abcdef... 或 123456|abcdef...</p>
        <TextArea 
          rows={10} 
          placeholder="123456:abcdef123456..." 
          value={lines} 
          onChange={(e) => setLines(e.target.value)} 
        />
      </Modal>
    </Card>
  );
};

export default ApiKeyManager;
