import React, { useState, useEffect, useRef } from 'react';
import { 
  Layout, Menu, Button, Table, Input, Form, Upload, 
  Card, Switch, Tag, message, Modal, InputNumber, Row, Col,
  Statistic, Tooltip, Progress, Drawer, Popconfirm
} from 'antd';
import { 
  UploadOutlined, UserOutlined, SendOutlined, 
  HistoryOutlined, StopOutlined, CheckCircleOutlined,
  SyncOutlined, FileTextOutlined, DeleteOutlined, PauseCircleOutlined
} from '@ant-design/icons';
import { 
  getSessions, uploadSession, sendCode, login, checkSession, getSessionOtp,
  createTask, getTasks, getLogs, getWsUrl, getLogStats, getTaskTargets,
  stopTask, deleteTask, batchCheckSessions, batchDeleteSessions, updateProfile
} from './api';
import BlacklistManager from './BlacklistManager';
import ProxyManager from './ProxyManager';
import ApiKeyManager from './ApiKeyManager';

const { Header, Content, Sider } = Layout;
const { TextArea } = Input;

function App() {
  const [activeTab, setActiveTab] = useState('tasks');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div className="logo" style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)' }} />
        <Menu 
          theme="dark" 
          defaultSelectedKeys={['tasks']} 
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={(e) => setActiveTab(e.key)}
        >
          <Menu.Item key="sessions" icon={<UserOutlined />}>账号管理</Menu.Item>
          <Menu.Item key="tasks" icon={<SendOutlined />}>任务管理</Menu.Item>
          <Menu.Item key="blacklist" icon={<StopOutlined />}>黑名单</Menu.Item>
          <Menu.Item key="proxies" icon={<StopOutlined />}>代理管理</Menu.Item>
          <Menu.Item key="apikeys" icon={<StopOutlined />}>API Key管理</Menu.Item>
          <Menu.Item key="logs" icon={<HistoryOutlined />}>日志</Menu.Item>
        </Menu>
      </Sider>
      <Layout className="site-layout">
        <Header className="site-layout-background" style={{ padding: 0, background: '#fff' }} />
        <Content style={{ margin: '16px' }}>
          <div className="site-layout-background" style={{ padding: 24, minHeight: 360 }}>
            {activeTab === 'sessions' && <SessionManager />}
            {activeTab === 'tasks' && <TaskManager />}
            {activeTab === 'blacklist' && <BlacklistManager />}
            {activeTab === 'proxies' && <ProxyManager />}
            {activeTab === 'apikeys' && <ApiKeyManager />}
            {activeTab === 'logs' && <LogViewer />}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

const SessionManager = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  
  // Profile Update State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileForm] = Form.useForm();
  
  // Phone Login State
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneHash, setPhoneHash] = useState("");
  const [step, setStep] = useState(1);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await getSessions();
      setSessions(res.items);
    } catch (e) {
      message.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSessions(); }, []);

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadApiId, setUploadApiId] = useState("35019294");
  const [uploadApiHash, setUploadApiHash] = useState("9e2d91fe6876d834bae4707b0875e2d7");
  const [fileList, setFileList] = useState([]);

  const handleUploadSubmit = async () => {
    if (!uploadApiId || !uploadApiHash) {
      message.error("请输入 API ID 和 API Hash");
      return;
    }
    if (fileList.length === 0) {
      message.error("请选择文件");
      return;
    }

    const formData = new FormData();
    fileList.forEach(file => {
      formData.append("files", file);
    });
    formData.append("api_id", uploadApiId);
    formData.append("api_hash", uploadApiHash);

    try {
      setLoading(true);
      await uploadSession(formData);
      message.success(`成功上传 ${fileList.length} 个会话`);
      setIsUploadModalOpen(false);
      setFileList([]);
      loadSessions();
    } catch (e) {
      message.error("上传失败: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const uploadProps = {
    multiple: true,
    onRemove: (file) => {
      setFileList((prev) => {
        const index = prev.indexOf(file);
        const newFileList = prev.slice();
        newFileList.splice(index, 1);
        return newFileList;
      });
    },
    beforeUpload: (_, fileList) => {
        setFileList(fileList);
        return false;
    },
    fileList,
  };

  const handleSendCode = async () => {
    try {
      const res = await sendCode(phone);
      setPhoneHash(res.phone_code_hash);
      setStep(2);
      message.success("验证码已发送");
    } catch (e) {
      message.error("发送验证码失败");
    }
  };

  const handleLogin = async () => {
    try {
      await login(phone, code, phoneHash);
      message.success("登录成功");
      setIsModalOpen(false);
      loadSessions();
      setStep(1);
      setPhone("");
      setCode("");
    } catch (e) {
      message.error("登录失败");
    }
  };

  const handleCheck = async (id) => {
    try {
      message.loading({ content: "检查中...", key: "check" });
      const res = await checkSession(id);
      message.success({ content: `状态: ${res.status}`, key: "check" });
      loadSessions();
    } catch (e) {
      message.error({ content: "检查失败", key: "check" });
    }
  };

  const handleGetOtp = async (id) => {
    try {
      message.loading({ content: "正在获取验证码...", key: "otp", duration: 0 });
      const res = await getSessionOtp(id);
      if (res.status === 'success') {
          message.success({ content: "获取成功", key: "otp" });
          Modal.success({
              title: "获取验证码成功",
              content: (
                  <div>
                      <p>验证码: <b style={{ fontSize: 18, color: 'red' }}>{res.code || "未找到"}</b></p>
                      <div style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8 }}>
                          {res.full_message}
                      </div>
                      <p style={{ marginTop: 8, fontSize: 12, color: '#999' }}>时间: {res.date}</p>
                  </div>
              )
          });
      } else {
          message.error({ content: "获取失败: " + res.message, key: "otp" });
      }
    } catch (e) {
      message.error({ content: "请求失败: " + e.message, key: "otp" });
    }
  };

  const handleBatchCheck = async () => {
    if (selectedRowKeys.length === 0) return message.warning("请选择账号");
    try {
      message.loading({ content: "批量检查中...", key: "batch_check", duration: 0 });
      await batchCheckSessions(selectedRowKeys);
      message.success({ content: "检查完成", key: "batch_check" });
      loadSessions();
      setSelectedRowKeys([]);
    } catch (e) {
      message.error({ content: "检查失败: " + e.message, key: "batch_check" });
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return message.warning("请选择账号");
    try {
      await batchDeleteSessions(selectedRowKeys);
      message.success("删除成功");
      setSelectedRowKeys([]);
      loadSessions();
    } catch (e) {
      message.error("删除失败");
    }
  };

  const handleDeleteBanned = async () => {
    const bannedIds = sessions.filter(s => s.status === 'banned' || s.status === 'restricted' || s.status === 'invalid').map(s => s.id);
    if (bannedIds.length === 0) return message.info("没有发现风控/封禁/无效账号");
    
    try {
      await batchDeleteSessions(bannedIds);
      message.success(`已删除 ${bannedIds.length} 个风控/无效账号`);
      loadSessions();
    } catch (e) {
      message.error("删除失败");
    }
  };

  const handleUpdateProfileSubmit = async () => {
    try {
      const values = await profileForm.validateFields();
      const formData = new FormData();
      formData.append("ids", selectedRowKeys.join(","));
      if (values.first_name) formData.append("first_name", values.first_name);
      if (values.about) formData.append("about", values.about);
      if (values.avatar && values.avatar.length > 0) {
          formData.append("avatar", values.avatar[0].originFileObj);
      }
      
      setLoading(true);
      await updateProfile(formData);
      message.success("更新成功");
      setIsProfileModalOpen(false);
      profileForm.resetFields();
      loadSessions();
      setSelectedRowKeys([]);
    } catch (e) {
      message.error("更新失败: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", key: "id" },
    { title: "手机号", dataIndex: "phone", key: "phone" },
    { title: "昵称", dataIndex: "nickname", key: "nickname", render: t => t || '-' },
    { title: "健康分", dataIndex: "health_score", key: "health_score", render: score => <Tag color={score > 80 ? 'green' : score > 50 ? 'orange' : 'red'}>{score}</Tag> },
    { 
      title: "状态", 
      dataIndex: "status", 
      key: "status",
      render: (status) => {
        let color = status === 'active' ? 'green' : status === 'banned' ? 'red' : 'orange';
        let text = status === 'active' ? '正常' : status === 'banned' ? '封禁' : status;
        return <Tag color={color}>{text.toUpperCase()}</Tag>;
      }
    },
    { 
      title: "上次使用", 
      dataIndex: "last_used", 
      key: "last_used",
      render: (text) => text || "-"
    },
    {
      title: "操作",
      key: "action",
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" icon={<SyncOutlined />} onClick={() => handleCheck(record.id)}>检查</Button>
            <Button size="small" onClick={() => handleGetOtp(record.id)}>取码</Button>
        </div>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button icon={<UploadOutlined />} onClick={() => setIsUploadModalOpen(true)}>上传</Button>
        <Button type="primary" onClick={() => setIsModalOpen(true)}>登录</Button>
        <Button icon={<SyncOutlined />} onClick={loadSessions}>刷新</Button>
        
        <Button onClick={() => setIsProfileModalOpen(true)} disabled={selectedRowKeys.length === 0}>
           批量修改资料
        </Button>
        <Button onClick={handleBatchCheck} disabled={selectedRowKeys.length === 0}>
           批量检测
        </Button>
        <Popconfirm title="确定删除选中账号?" onConfirm={handleBatchDelete}>
           <Button danger disabled={selectedRowKeys.length === 0} icon={<DeleteOutlined />}>批量删除</Button>
        </Popconfirm>
        <Popconfirm title="确定删除所有风控/封禁账号?" onConfirm={handleDeleteBanned}>
            <Button danger>删除风控账号</Button>
        </Popconfirm>
      </div>
      
      <Table 
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        dataSource={sessions} 
        columns={columns} 
        rowKey="id" 
        loading={loading} 
        pagination={false}
      />

      <Modal
        title={`批量修改资料 (已选 ${selectedRowKeys.length} 个)`}
        open={isProfileModalOpen}
        onOk={handleUpdateProfileSubmit}
        onCancel={() => setIsProfileModalOpen(false)}
        okText="开始修改"
        cancelText="取消"
      >
        <Form form={profileForm} layout="vertical">
            <Form.Item label="新昵称 (First Name)" name="first_name">
                <Input placeholder="留空则不修改" />
            </Form.Item>
            <Form.Item label="新简介 (About)" name="about">
                <TextArea placeholder="留空则不修改" rows={2} />
            </Form.Item>
            <Form.Item label="新头像" name="avatar" valuePropName="fileList" getValueFromEvent={e => {
                if (Array.isArray(e)) return e;
                return e && e.fileList;
            }}>
                <Upload beforeUpload={() => false} maxCount={1} listType="picture">
                    <Button icon={<UploadOutlined />}>选择图片</Button>
                </Upload>
            </Form.Item>
        </Form>
      </Modal>

      <Modal 
        title="上传会话文件 (支持批量)" 
        open={isUploadModalOpen} 
        onOk={handleUploadSubmit} 
        onCancel={() => {
          setIsUploadModalOpen(false);
          setFileList([]);
        }}
        okText="开始上传"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>API ID:</div>
          <Input 
            value={uploadApiId} 
            onChange={e => setUploadApiId(e.target.value)} 
            placeholder="例如: 123456"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>API Hash:</div>
          <Input 
            value={uploadApiHash} 
            onChange={e => setUploadApiHash(e.target.value)} 
            placeholder="例如: abcdef123456..."
          />
        </div>
        <Upload {...uploadProps}>
          <Button icon={<UploadOutlined />}>选择文件 (.session 或 .zip)</Button>
        </Upload>
      </Modal>

      <Modal title="手机号登录" open={isModalOpen} onCancel={() => setIsModalOpen(false)} footer={null}>
        {step === 1 ? (
          <div>
            <Input placeholder="手机号 (例如 +8613800000000)" value={phone} onChange={e => setPhone(e.target.value)} />
            <Button type="primary" onClick={handleSendCode} style={{ marginTop: 10 }} block>发送验证码</Button>
          </div>
        ) : (
          <div>
            <Input placeholder="验证码" value={code} onChange={e => setCode(e.target.value)} />
            <Button type="primary" onClick={handleLogin} style={{ marginTop: 10 }} block>登录</Button>
          </div>
        )}
      </Modal>
    </div>
  );
};

const TaskDetailDrawer = ({ taskId, onClose }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all, pending, success, failed

  const loadData = async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await getTaskTargets(taskId);
      setItems(res.items);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'pending') return item.status === 'pending';
    if (filter === 'success') return item.status === 'success';
    if (filter === 'failed') return item.status === 'failed' || item.status === 'skipped';
    return true;
  });
  
  // Auto-clear logic: User asked to "clear successful ones from pending list"
  // If we view "Pending", successful ones automatically disappear.
  // We can provide a default view that excludes success.

  const columns = [
    { title: "目标", dataIndex: "target", key: "target" },
    { 
      title: "状态", 
      dataIndex: "status", 
      key: "status",
      render: status => {
        let color = status === 'success' ? 'green' : status === 'failed' ? 'red' : status === 'pending' ? 'orange' : 'default';
        return <Tag color={color}>{status}</Tag>;
      }
    },
    { title: "执行账号", dataIndex: "sender_phone", key: "sender_phone", render: t => t || '-' },
    { title: "执行时间", dataIndex: "executed_at", key: "executed_at", render: t => t ? new Date(t).toLocaleTimeString() : '-' },
    { title: "备注", dataIndex: "error", key: "error", ellipsis: true },
  ];

  return (
    <Drawer
      title={`任务 #${taskId} 详情`}
      placement="right"
      width={700}
      onClose={onClose}
      open={!!taskId}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>筛选:</div>
        <Button.Group>
            <Button type={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')}>全部</Button>
            <Button type={filter === 'pending' ? 'primary' : 'default'} onClick={() => setFilter('pending')}>待发送</Button>
            <Button type={filter === 'success' ? 'primary' : 'default'} onClick={() => setFilter('success')}>成功</Button>
            <Button type={filter === 'failed' ? 'primary' : 'default'} onClick={() => setFilter('failed')}>失败</Button>
        </Button.Group>
        <span style={{ marginLeft: 16, color: '#999' }}>
           共 {items.length} 条，显示 {filteredItems.length} 条
        </span>
      </div>
      
      <Table 
        dataSource={filteredItems} 
        columns={columns} 
        rowKey="id" 
        size="small" 
        loading={loading}
        pagination={{ pageSize: 20 }}
      />
    </Drawer>
  );
};

const TaskManager = () => {
  const [form] = Form.useForm();
  const [targets, setTargets] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState(null);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const res = await getTasks();
      setTasks(res.items);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  const onFinish = async (values) => {
    // Parse targets
    const targetList = targets.split('\n').map(t => t.trim()).filter(t => t);
    if (targetList.length === 0) {
      message.error("请至少输入一个目标用户");
      return;
    }
    
    // Check for duplicates in submission
    const uniqueTargets = [...new Set(targetList)];
    if (uniqueTargets.length !== targetList.length) {
      message.warning(`检测到重复目标，已自动去重。原: ${targetList.length}, 去重后: ${uniqueTargets.length}`);
    }

    const payload = {
      message: messageTemplate,
      targets: uniqueTargets,
      delay_seconds: values.delay_seconds,
      random_delay: values.random_delay,
      max_per_account: values.max_per_account
    };

    try {
      await createTask(payload);
      message.success(`任务已创建，共 ${uniqueTargets.length} 个目标`);
      form.resetFields();
      setTargets("");
      setMessageTemplate("");
      loadTasks();
    } catch (e) {
      message.error("任务创建失败");
    }
  };

  const handleFileUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      setTargets(text);
      message.success(`已加载 ${text.split('\n').length} 行数据`);
    };
    reader.readAsText(file);
    return false;
  };

  const handleStop = async (id) => {
    try {
        await stopTask(id);
        message.success("任务已停止");
        loadTasks();
    } catch (e) {
        message.error("停止失败");
    }
  };

  const handleDelete = async (id) => {
    try {
        await deleteTask(id);
        message.success("任务已删除");
        if (selectedTaskId === id) setSelectedTaskId(null);
        if (detailTaskId === id) setDetailTaskId(null);
        loadTasks();
    } catch (e) {
        message.error("删除失败");
    }
  };

  const taskColumns = [
    { title: "ID", dataIndex: "id", key: "id", width: 60 },
    { 
      title: "消息预览", 
      dataIndex: "message", 
      key: "message", 
      ellipsis: true,
      render: (text) => <Tooltip title={text}>{text.slice(0, 20)}...</Tooltip>
    },
    { 
      title: "进度", 
      key: "progress",
      width: 250,
      render: (_, record) => {
        const total = record.total_count || 0;
        const success = record.success_count || 0;
        const failed = record.fail_count || 0;
        const percent = total > 0 ? Math.floor(((success + failed) / total) * 100) : 0;
        
        return (
          <div>
            <Progress percent={percent} size="small" status={record.status === 'running' ? 'active' : 'normal'} />
            <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span>总: {total}</span>
              <span style={{ color: '#52c41a' }}>成: {success}</span>
              <span style={{ color: '#ff4d4f' }}>败: {failed}</span>
            </div>
          </div>
        );
      }
    },
    { 
      title: "状态", 
      dataIndex: "status", 
      key: "status",
      render: status => {
        let color = status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'running' ? 'processing' : 'default';
        return <Tag color={color}>{status}</Tag>;
      }
    },
    { title: "创建时间", dataIndex: "created_at", key: "created_at", render: t => t ? new Date(t).toLocaleString() : '-' },
    {
         title: "操作",
         key: "action",
         width: 220,
         render: (_, record) => (
             <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Button size="small" type="primary" onClick={() => setDetailTaskId(record.id)}>待发送</Button>
                <Button size="small" onClick={() => setSelectedTaskId(record.id)}>日志</Button>
                {record.status === 'running' && (
                    <Popconfirm title="确定停止任务?" onConfirm={() => handleStop(record.id)}>
                        <Button size="small" icon={<PauseCircleOutlined />} danger>停止</Button>
                    </Popconfirm>
                )}
                <Popconfirm title="确定删除任务?" description="这将删除相关日志和记录" onConfirm={() => handleDelete(record.id)}>
                    <Button size="small" icon={<DeleteOutlined />} danger />
                </Popconfirm>
             </div>
         )
     }
  ];

  return (
    <Row gutter={24}>
      <TaskDetailDrawer taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />
      <Col span={8}>
        <Card title="创建新任务" extra={
          <Upload beforeUpload={handleFileUpload} showUploadList={false}>
            <Tooltip title="导入 TXT/CSV">
              <Button icon={<FileTextOutlined />} size="small" />
            </Tooltip>
          </Upload>
        }>
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>目标列表 (每行一个 @username 或手机号):</div>
            <TextArea 
              rows={10} 
              placeholder="@user1&#10;@user2&#10;+8613800000000" 
              value={targets}
              onChange={e => setTargets(e.target.value)}
            />
            <div style={{ textAlign: 'right', fontSize: 12, color: '#888', marginTop: 4 }}>
               共 {targets ? targets.split('\n').filter(t => t.trim()).length : 0} 个目标
            </div>
          </div>
          
          <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ delay_seconds: 30, max_per_account: 20, random_delay: true }}>
            <Form.Item label="消息模板 (支持 Spintax {Hi|Hello})" name="message_template">
               <TextArea 
                rows={4} 
                value={messageTemplate} 
                onChange={e => setMessageTemplate(e.target.value)} 
                placeholder="你好 {朋友|兄弟}..." 
              />
            </Form.Item>
            
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="间隔 (秒)" name="delay_seconds">
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="单号上限" name="max_per_account">
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
             <Form.Item name="random_delay" valuePropName="checked">
                 <Switch checkedChildren="随机延迟" unCheckedChildren="固定延迟" />
            </Form.Item>

            <Button type="primary" htmlType="submit" icon={<SendOutlined />} block>
              开始任务
            </Button>
          </Form>
        </Card>
      </Col>
      <Col span={16}>
        <Card title="任务列表" style={{ marginBottom: 24 }}>
          <Table 
            dataSource={tasks} 
            columns={taskColumns} 
            rowKey="id" 
            pagination={{ pageSize: 5 }} 
            size="small"
          />
        </Card>
        
        {selectedTaskId && (
            <div style={{ marginBottom: 24 }}>
                <h4>任务 #{selectedTaskId} 详情</h4>
                <LogViewer embedded taskId={selectedTaskId} />
            </div>
        )}
        {!selectedTaskId && <LogViewer embedded />}
      </Col>
    </Row>
  );
};

const LogStats = () => {
  const [stats, setStats] = useState([]);
  const [limit, setLimit] = useState(0);

  const fetchStats = async () => {
    try {
      const res = await getLogStats();
      setStats(res.stats || []);
      setLimit(res.limit || 0);
    } catch (e) {
      // silent fail
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const columns = [
    { 
      title: "账号", 
      dataIndex: "phone", 
      key: "phone",
      width: 150
    },
    { 
      title: "进度", 
      key: "progress",
      render: (_, record) => {
        let percent = 0;
        if (limit > 0) {
          percent = Math.floor((record.success / limit) * 100);
        }
        return (
          <div style={{ width: 180 }}>
            <Progress percent={percent} size="small" status="active" strokeColor={percent > 100 ? '#52c41a' : undefined} />
          </div>
        );
      }
    },
    { 
      title: "成功", 
      dataIndex: "success", 
      key: "success",
      render: val => <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{val}</span>
    },
    { 
      title: "失败", 
      dataIndex: "failed", 
      key: "failed",
      render: val => <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{val}</span>
    },
    {
      title: "限制",
      key: "limit",
      render: (_, record) => `${record.success}/${limit}`
    }
  ];

  if (stats.length === 0) return null;

  return (
    <Card size="small" style={{ marginBottom: 0 }}>
      <Table 
        dataSource={stats} 
        columns={columns} 
        rowKey="phone" 
        pagination={false} 
        size="small"
        scroll={{ y: 240 }} 
      />
      <div style={{ textAlign: 'right', marginTop: 8, color: '#999', fontSize: 12 }}>
        更新于 {new Date().toLocaleTimeString()}
      </div>
    </Card>
  );
};

const LogViewer = ({ embedded, taskId }) => {
  const [logs, setLogs] = useState([]);
  const bottomRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    // Initial load
    setLogs([]); // Clear logs when switching task
    
    // Helper to fetch logs
    const fetchLogs = async () => {
        try {
            const res = await getLogs(taskId);
            setLogs(res.items); // Already sorted DESC from backend
        } catch (e) {
            console.error("Failed to fetch logs", e);
        }
    };
    
    fetchLogs();

    // WebSocket
    const wsUrl = getWsUrl(taskId);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Filter if needed (backend should filter but double check)
        if (taskId && data.task_id != taskId) return;
        setLogs(prev => [data, ...prev]); // Prepend new logs
      } catch (e) {}
    };

    return () => {
      ws.close();
    };
  }, [taskId]);

  const columns = [
    { title: "时间", dataIndex: "time", key: "time", width: 180 },
    { title: "目标", dataIndex: "target", key: "target" },
    { 
      title: "状态", 
      dataIndex: "status", 
      key: "status",
      render: status => {
        let color = status === 'success' ? 'green' : status === 'failed' ? 'red' : 'blue';
        let text = status === 'success' ? '成功' : status === 'failed' ? '失败' : status;
        return <Tag color={color}>{text}</Tag>;
      }
    },
    { title: "信息", dataIndex: "error", key: "error" },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <LogStats />
      <Card title="实时日志" size={embedded ? "small" : "default"} extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" danger onClick={() => setLogs([])}>清空日志</Button>
        </div>
      }>
        <div style={{ maxHeight: embedded ? 400 : 'calc(100vh - 400px)', overflowY: 'auto' }}>
          <Table 
            dataSource={logs} 
            columns={columns} 
            rowKey={(r) => r.id || Math.random()} 
            pagination={false} 
            size="small"
          />
        </div>
      </Card>
    </div>
  );
};

export default App;
