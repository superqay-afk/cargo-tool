# 3PL货源沉淀工作台 - 技术架构重构方案

## 1. 架构设计

### 1.1 整体架构图

```mermaid
graph TD
    A["用户浏览器"] --> B["React Frontend App"]
    B --> C["API Gateway"]
    C --> D["Auth Service"]
    C --> E["Business Service"]
    C --> F["File Service"]
    
    D --> G["Supabase Auth"]
    E --> H["Supabase Database"]
    E --> I["Feishu OpenAPI"]
    F --> J["Object Storage"]
    
    E --> K["Redis Cache"]
    E --> L["Message Queue"]
    
    subgraph "Frontend Layer"
        B
    end
    
    subgraph "API Layer"
        C
    end
    
    subgraph "Service Layer"
        D
        E
        F
    end
    
    subgraph "Data Layer"
        G
        H
        K
    end
    
    subgraph "External Services"
        I
        J
    end
```

### 1.2 技术选型说明

**架构演进思路**：从当前的简单Python服务演进为现代化的微服务架构，提升系统的可扩展性、可维护性和可靠性。

## 2. 技术描述

### 2.1 前端技术栈
- **框架**: React 18 + TypeScript 5.x
- **构建工具**: Vite 5.x
- **状态管理**: Zustand 4.x + React Query 5.x
- **UI组件**: Ant Design 5.x + Tailwind CSS 3.x
- **图表**: Apache ECharts 5.x
- **3D可视化**: Three.js + @react-three/fiber (预留)

### 2.2 后端技术栈
- **API网关**: Kong Gateway 或 Nginx + Lua
- **认证服务**: Node.js + Express + Supabase Auth
- **业务服务**: Python FastAPI + SQLAlchemy
- **文件服务**: Node.js + Multer + AWS S3 SDK
- **缓存**: Redis 7.x
- **消息队列**: Redis Pub/Sub 或 RabbitMQ

### 2.3 数据存储
- **主数据库**: Supabase (PostgreSQL 15)
- **缓存层**: Redis Cluster
- **对象存储**: Supabase Storage 或 AWS S3
- **搜索引擎**: PostgreSQL全文搜索 + Redis Search

### 2.4 运维工具
- **容器化**: Docker + Docker Compose
- **监控**: Prometheus + Grafana
- **日志**: ELK Stack (Elasticsearch + Logstash + Kibana)
- **CI/CD**: GitHub Actions

### 2.5 初始化工具
- **前端**: create-vite (React + TypeScript模板)
- **后端**: 自定义脚手架（集成FastAPI最佳实践）

## 3. 路由定义

### 3.1 前端路由
| Route | Purpose | 权限要求 |
|-------|---------|----------|
| / | 工作台首页，货源列表和操作面板 | 登录用户 |
| /login | 登录页面，支持飞书OAuth | 匿名用户 |
| /dashboard | 数据仪表板，展示统计信息 | 登录用户 |
| /cargo/:id | 货源详情页，编辑和处理流程 | 登录用户 |
| /cargo/batch | 批量处理页面 | 登录用户 |
| /settings | 系统设置，包含偏好配置 | 登录用户 |
| /settings/mapping | 字段映射配置 | 管理员 |
| /settings/drivers | 运力池管理 | 登录用户 |
| /analytics | 数据分析页面 | 管理员 |
| /profile | 个人设置 | 登录用户 |

### 3.2 API路由分组

#### 认证相关
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/user
- POST /api/auth/refresh
- GET /api/auth/feishu/callback

#### 货源管理
- GET /api/cargos - 获取货源列表（支持分页、筛选、排序）
- POST /api/cargos - 创建货源
- GET /api/cargos/:id - 获取货源详情
- PUT /api/cargos/:id - 更新货源
- DELETE /api/cargos/:id - 删除货源
- POST /api/cargos/batch - 批量创建/更新货源
- POST /api/cargos/parse - 智能解析货源信息
- POST /api/cargos/complete - 智能补全货源信息

#### 飞书集成
- GET /api/feishu/status - 获取连接状态
- POST /api/feishu/connect - 建立飞书连接
- DELETE /api/feishu/disconnect - 断开飞书连接
- GET /api/feishu/tables - 获取飞书表格列表
- POST /api/feishu/sync - 同步数据到飞书
- GET /api/feishu/records - 获取飞书记录

#### 系统配置
- GET /api/settings - 获取系统配置
- PUT /api/settings - 更新系统配置
- GET /api/settings/mapping - 获取字段映射
- PUT /api/settings/mapping - 更新字段映射
- GET /api/settings/drivers - 获取运力池
- POST /api/settings/drivers - 添加司机
- PUT /api/settings/drivers/:id - 更新司机信息
- DELETE /api/settings/drivers/:id - 删除司机

#### 数据分析
- GET /api/analytics/overview - 获取概览数据
- GET /api/analytics/trends - 获取趋势数据
- GET /api/analytics/efficiency - 获取效率指标
- GET /api/analytics/errors - 获取错误统计

## 4. API定义

### 4.1 认证相关API

#### 用户登录
```
POST /api/auth/login
```

请求参数：
| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| username | string | 是 | 用户名或邮箱 |
| password | string | 是 | 密码 |
| remember | boolean | 否 | 记住登录状态 |

响应示例：
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_123",
      "username": "dispatcher_wang",
      "email": "wang@company.com",
      "role": "dispatcher",
      "permissions": ["cargo.create", "cargo.update"]
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400
  }
}
```

### 4.2 货源管理API

#### 创建货源
```
POST /api/cargos
```

请求体：
```json
{
  "rawText": "成都到广州，冻品猪肉，9.6米冷藏车，30吨，明天装货",
  "source": "manual_input",
  "channelId": "CH001"
}
```

响应示例：
```json
{
  "success": true,
  "data": {
    "id": "cargo_20240318_001",
    "rawText": "成都到广州，冻品猪肉，9.6米冷藏车，30吨，明天装货",
    "parsedData": {
      "originCity": "成都",
      "destinationCity": "广州",
      "goodsType": "冻品猪肉",
      "vehicleType": "冷藏车",
      "vehicleLength": "9.6米",
      "weight": 30,
      "loadTime": "2024-03-19T08:00:00Z"
    },
    "stageId": 1,
    "status": "draft",
    "blocked": false,
    "createdAt": "2024-03-18T10:30:00Z",
    "updatedAt": "2024-03-18T10:30:00Z"
  }
}
```

### 4.3 通用数据类型定义

#### 货源状态枚举
```typescript
enum CargoStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  READY = 'ready',
  SUNK_FEISHU = 'sunk_feishu',
  ON_SHELF = 'on_shelf',
  DEALT = 'dealt',
  IN_TRANSIT = 'in_transit',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

enum StageId {
  PARSE = 1,
  COMPLETE = 2,
  FIND_VEHICLE = 3,
  SYNC_FEISHU = 4
}

enum RiskLevel {
  RED = 'red',
  YELLOW = 'yellow',
  BLUE = 'blue'
}
```

#### 核心数据模型
```typescript
interface Cargo {
  id: string;
  rawText: string;
  parsedData: ParsedCargoData;
  stageId: StageId;
  status: CargoStatus;
  blocked: boolean;
  riskLevel?: RiskLevel;
  risks: RiskItem[];
  feishuRecordId?: string;
  platformData?: PlatformData;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

interface ParsedCargoData {
  originCity: string;
  originDistrict?: string;
  originAddress?: string;
  destinationCity: string;
  destinationDistrict?: string;
  destinationAddress?: string;
  goodsCategory: string;
  goodsWeight?: number;
  goodsVolume?: number;
  temperatureRequirement?: string;
  vehicleType: string;
  vehicleLength?: string;
  loadTime?: string;
  freightPrice?: number;
  paymentMethod?: string;
  originContact?: ContactInfo;
  destinationContact?: ContactInfo;
}

interface RiskItem {
  ruleId: string;
  level: RiskLevel;
  field: string;
  message: string;
  suggestion?: string;
}
```

## 5. 服务器架构图

### 5.1 服务分层架构
```mermaid
graph TD
    A["Client Browser"] --> B["Load Balancer"]
    B --> C["API Gateway Cluster"]
    
    C --> D["Auth Service"]
    C --> E["Cargo Service"]
    C --> F["Feishu Service"]
    C --> G["Analytics Service"]
    
    D --> H["Supabase Auth"]
    E --> I["Supabase DB"]
    F --> J["Feishu OpenAPI"]
    G --> K["Redis Cache"]
    
    E --> L["Message Queue"]
    F --> L
    
    I --> M["Read Replica"]
    K --> N["Redis Sentinel"]
    
    subgraph "Frontend Layer"
        A
    end
    
    subgraph "Load Balancing Layer"
        B
    end
    
    subgraph "API Gateway Layer"
        C
    end
    
    subgraph "Application Service Layer"
        D
        E
        F
        G
    end
    
    subgraph "Data Persistence Layer"
        H
        I
        M
    end
    
    subgraph "Cache Layer"
        K
        N
    end
    
    subgraph "Message Layer"
        L
    end
```

### 5.2 微服务职责划分

#### API网关服务
- 统一入口和路由
- 认证和授权验证
- 限流和熔断
- 日志收集和监控
- 协议转换（HTTP/WebSocket）

#### 认证服务
- 用户注册和登录
- OAuth集成（飞书、微信等）
- Token生成和验证
- 权限管理
- 会话管理

#### 货源服务
- 货源CRUD操作
- 智能解析和补全
- 风险诊断
- 状态流转管理
- 批量操作处理

#### 飞书同步服务
- 飞书OAuth管理
- 多维表操作
- 数据同步和冲突解决
- 字段映射管理
- 同步状态监控

#### 数据分析服务
- 业务指标统计
- 趋势分析
- 效率评估
- 异常检测
- 报表生成

## 6. 数据模型

### 6.1 数据库实体关系图
```mermaid
erDiagram
    USERS ||--o{ CARGOS : creates
    USERS ||--o{ SETTINGS : configures
    CARGOS ||--o{ CARGO_LOGS : has
    CARGOS ||--o{ RISK_ITEMS : contains
    CARGOS ||--o{ FEISHU_RECORDS : syncs_to
    USERS ||--o{ DRIVERS : manages
    USERS ||--o{ MAPPINGS : defines
    
    USERS {
        uuid id PK
        string username
        string email
        string password_hash
        string role
        jsonb permissions
        jsonb profile
        timestamp created_at
        timestamp updated_at
        timestamp last_login_at
        boolean is_active
    }
    
    CARGOS {
        uuid id PK
        string cargo_id
        string raw_text
        jsonb parsed_data
        integer stage_id
        string status
        boolean blocked
        jsonb risks
        uuid feishu_record_id FK
        uuid created_by FK
        uuid updated_by FK
        timestamp created_at
        timestamp updated_at
        timestamp deleted_at
    }
    
    CARGO_LOGS {
        uuid id PK
        uuid cargo_id FK
        string action
        jsonb changes
        uuid performed_by FK
        timestamp created_at
        string ip_address
        string user_agent
    }
    
    RISK_ITEMS {
        uuid id PK
        uuid cargo_id FK
        string rule_id
        string level
        string field
        string message
        string suggestion
        boolean resolved
        timestamp created_at
        timestamp resolved_at
    }
    
    FEISHU_RECORDS {
        uuid id PK
        string feishu_record_id
        string app_token
        string table_id
        jsonb record_data
        string sync_status
        timestamp last_sync_at
        uuid cargo_id FK
    }
    
    DRIVERS {
        uuid id PK
        string driver_id
        string name
        string phone
        string vehicle_type
        string vehicle_length
        jsonb vehicle_info
        jsonb tags
        integer rating
        boolean is_active
        uuid managed_by FK
        timestamp created_at
        timestamp updated_at
    }
    
    SETTINGS {
        uuid id PK
        uuid user_id FK
        string setting_type
        jsonb setting_data
        timestamp created_at
        timestamp updated_at
    }
    
    MAPPINGS {
        uuid id PK
        uuid user_id FK
        string mapping_type
        jsonb field_mappings
        jsonb transformation_rules
        timestamp created_at
        timestamp updated_at
    }
```

### 6.2 数据定义语言（DDL）

#### 用户表
```sql
-- 创建用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'dispatcher' CHECK (role IN ('admin', 'dispatcher', 'viewer')),
    permissions JSONB DEFAULT '[]',
    profile JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 创建索引
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
```

#### 货源表
```sql
-- 创建货源表
CREATE TABLE cargos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cargo_id VARCHAR(100) UNIQUE NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_data JSONB DEFAULT '{}',
    stage_id INTEGER DEFAULT 1 CHECK (stage_id BETWEEN 1 AND 4),
    status VARCHAR(50) DEFAULT 'draft',
    blocked BOOLEAN DEFAULT false,
    risks JSONB DEFAULT '[]',
    feishu_record_id UUID REFERENCES feishu_records(id),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 创建索引
CREATE INDEX idx_cargos_cargo_id ON cargos(cargo_id);
CREATE INDEX idx_cargos_status ON cargos(status);
CREATE INDEX idx_cargos_stage_id ON cargos(stage_id);
CREATE INDEX idx_cargos_blocked ON cargos(blocked);
CREATE INDEX idx_cargos_created_by ON cargos(created_by);
CREATE INDEX idx_cargos_created_at ON cargos(created_at DESC);
CREATE INDEX idx_cargos_parsed_data ON cargos USING GIN (parsed_data);
```

#### 货源日志表
```sql
-- 创建货源日志表
CREATE TABLE cargo_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cargo_id UUID REFERENCES cargos(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    changes JSONB DEFAULT '{}',
    performed_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- 创建索引
CREATE INDEX idx_cargo_logs_cargo_id ON cargo_logs(cargo_id);
CREATE INDEX idx_cargo_logs_performed_by ON cargo_logs(performed_by);
CREATE INDEX idx_cargo_logs_created_at ON cargo_logs(created_at DESC);
CREATE INDEX idx_cargo_logs_action ON cargo_logs(action);
```

#### 风险项表
```sql
-- 创建风险项表
CREATE TABLE risk_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cargo_id UUID REFERENCES cargos(id) ON DELETE CASCADE,
    rule_id VARCHAR(100) NOT NULL,
    level VARCHAR(20) CHECK (level IN ('red', 'yellow', 'blue')),
    field VARCHAR(100),
    message TEXT NOT NULL,
    suggestion TEXT,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- 创建索引
CREATE INDEX idx_risk_items_cargo_id ON risk_items(cargo_id);
CREATE INDEX idx_risk_items_level ON risk_items(level);
CREATE INDEX idx_risk_items_resolved ON risk_items(resolved);
CREATE INDEX idx_risk_items_rule_id ON risk_items(rule_id);
```

#### 司机表
```sql
-- 创建司机表
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    vehicle_type VARCHAR(100),
    vehicle_length VARCHAR(50),
    vehicle_info JSONB DEFAULT '{}',
    tags JSONB DEFAULT '[]',
    rating INTEGER DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    is_active BOOLEAN DEFAULT true,
    managed_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_drivers_driver_id ON drivers(driver_id);
CREATE INDEX idx_drivers_name ON drivers(name);
CREATE INDEX idx_drivers_phone ON drivers(phone);
CREATE INDEX idx_drivers_managed_by ON drivers(managed_by);
CREATE INDEX idx_drivers_is_active ON drivers(is_active);
CREATE INDEX idx_drivers_rating ON drivers(rating DESC);
```

#### 设置表
```sql
-- 创建设置表
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    setting_type VARCHAR(100) NOT NULL,
    setting_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, setting_type)
);

-- 创建索引
CREATE INDEX idx_settings_user_id ON settings(user_id);
CREATE INDEX idx_settings_setting_type ON settings(setting_type);
```

### 6.3 初始数据

#### 创建默认管理员用户
```sql
-- 插入默认管理员（密码需要重置）
INSERT INTO users (username, email, password_hash, role, permissions) VALUES 
('admin', 'admin@company.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.PJ/..G', 'admin', '["*"]');
```

#### 创建默认设置
```sql
-- 插入默认系统设置
INSERT INTO settings (user_id, setting_type, setting_data) VALUES 
((SELECT id FROM users WHERE username = 'admin'), 'system', '{
  "defaultPaymentMethod": "到付",
  "defaultInvoiceType": "普票",
  "priceRiskThreshold": 0.2,
  "duplicateCheckFields": ["originCity", "destinationCity", "goodsCategory", "loadTime"],
  "batchSize": 50,
  "syncInterval": 300
}');
```

### 6.4 权限配置（Supabase RLS策略）

#### 用户表权限
```sql
-- 启用RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 允许用户查看自己的数据
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid() = id);

-- 允许管理员查看所有用户
CREATE POLICY "Admins can view all users" ON users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
```

#### 货源表权限
```sql
-- 启用RLS
ALTER TABLE cargos ENABLE ROW LEVEL SECURITY;

-- 允许用户查看自己创建的货源
CREATE POLICY "Users can view own cargos" ON cargos
    FOR SELECT USING (created_by = auth.uid());

-- 允许用户创建货源
CREATE POLICY "Users can create cargos" ON cargos
    FOR INSERT WITH CHECK (created_by = auth.uid());

-- 允许用户更新自己创建的货源
CREATE POLICY "Users can update own cargos" ON cargos
    FOR UPDATE USING (created_by = auth.uid());

-- 允许管理员查看所有货源
CREATE POLICY "Admins can view all cargos" ON cargos
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
```

### 6.5 性能优化索引

#### 复合索引
```sql
-- 货源查询优化
CREATE INDEX idx_cargos_status_stage ON cargos(status, stage_id);
CREATE INDEX idx_cargos_created_blocked ON cargos(created_at DESC, blocked);
CREATE INDEX idx_cargos_search ON cargos USING GIN (parsed_data, raw_text);

-- 日志查询优化
CREATE INDEX idx_cargo_logs_cargo_action ON cargo_logs(cargo_id, action);
CREATE INDEX idx_cargo_logs_time_range ON cargo_logs(created_at, cargo_id);

-- 风险查询优化
CREATE INDEX idx_risk_items_cargo_level ON risk_items(cargo_id, level);
```

---

## 7. 部署架构

### 7.1 容器化部署
```yaml
# docker-compose.yml
version: '3.8'
services:
  # API网关
  kong:
    image: kong:3.5
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /kong/kong.yml
      KONG_PROXY_ACCESS_LOG: /dev/stdout
      KONG_ADMIN_ACCESS_LOG: /dev/stdout
      KONG_PROXY_ERROR_LOG: /dev/stderr
      KONG_ADMIN_ERROR_LOG: /dev/stderr
      KONG_ADMIN_LISTEN: 0.0.0.0:8001
    ports:
      - "8000:8000"
      - "8001:8001"
    volumes:
      - ./kong:/kong
  
  # 前端应用
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    environment:
      - REACT_APP_API_URL=http://api-gateway:8000
      - REACT_APP_ENV=production
  
  # 认证服务
  auth-service:
    build: ./services/auth
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
    depends_on:
      - redis
  
  # 货源服务
  cargo-service:
    build: ./services/cargo
    ports:
      - "3002:3002"
    environment:
      - ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
    depends_on:
      - redis
      - postgres
  
  # 飞书服务
  feishu-service:
    build: ./services/feishu
    ports:
      - "3003:3003"
    environment:
      - ENV=production
      - FEISHU_APP_ID=${FEISHU_APP_ID}
      - FEISHU_APP_SECRET=${FEISHU_APP_SECRET}
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - redis
  
  # 分析服务
  analytics-service:
    build: ./services/analytics
    ports:
      - "3004:3004"
    environment:
      - ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
      - postgres
  
  # Redis缓存
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
  
  # PostgreSQL数据库
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=cargo_management
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
  
  # Nginx反向代理
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - ./logs/nginx:/var/log/nginx
    depends_on:
      - frontend
      - kong

volumes:
  redis_data:
  postgres_data:
```

### 7.2 环境配置

#### 生产环境配置
```bash
# .env.production
NODE_ENV=production
API_URL=https://api.cargo-platform.com
FRONTEND_URL=https://cargo-platform.com

# Supabase配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# 飞书配置
FEISHU_APP_ID=your-app-id
FEISHU_APP_SECRET=your-app-secret
FEISHU_ENCRYPT_KEY=your-encrypt-key
FEISHU_VERIFICATION_TOKEN=your-verification-token

# 数据库配置
DATABASE_URL=postgresql://user:password@postgres:5432/cargo_management
DATABASE_POOL_SIZE=20

# Redis配置
REDIS_URL=redis://redis:6379
REDIS_POOL_SIZE=10

# JWT配置
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=7d

# 文件上传配置
MAX_FILE_SIZE=10485760  # 10MB
UPLOAD_PATH=/app/uploads
ALLOWED_FILE_TYPES=txt,csv,xls,xlsx,pdf,png,jpg,jpeg

# 监控配置
SENTRY_DSN=your-sentry-dsn
LOG_LEVEL=info
METRICS_ENABLED=true

# 性能配置
CACHE_TTL=300
RATE_LIMIT_WINDOW=900000  # 15分钟
RATE_LIMIT_MAX_REQUESTS=100
```

---

## 8. 监控与告警

### 8.1 监控指标体系

#### 业务指标
- 货源创建成功率
- 飞书同步成功率
- 平均处理时间
- 用户活跃度
- 系统吞吐量

#### 技术指标
- API响应时间（P50, P95, P99）
- 错误率和状态码分布
- 数据库查询性能
- 缓存命中率
- 服务可用性

### 8.2 告警规则配置

#### 关键告警
```yaml
# 业务告警
- alert: CargoProcessingFailure
  expr: rate(cargo_processing_failures[5m]) > 0.1
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "货源处理失败率过高"
    description: "过去5分钟货源处理失败率超过10%"

# 技术告警
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "HTTP错误率过高"
    description: "过去5分钟HTTP 5xx错误率超过5%"

- alert: SlowQueries
  expr: pg_stat_statements_mean_time > 1000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "数据库查询缓慢"
    description: "数据库平均查询时间超过1秒"
```

---

## 9. 安全考虑

### 9.1 认证与授权
- JWT Token实现无状态认证
- RBAC权限模型控制访问
- API级别的权限验证
- 定期Token刷新机制

### 9.2 数据安全
- 敏感数据加密存储
- 传输层HTTPS加密
- 数据库连接SSL加密
- 定期安全审计

### 9.3 防护措施
- API限流防刷
- SQL注入防护
- XSS攻击防护
- CSRF令牌验证
- 文件上传安全检查

---

## 10. 性能优化策略

### 10.1 前端优化
- 代码分割和懒加载
- 图片压缩和WebP格式
- CDN加速静态资源
- 浏览器缓存策略
- Service Worker离线支持

### 10.2 后端优化
- 数据库查询优化
- Redis缓存策略
- 异步处理耗时操作
- 连接池管理
- API响应压缩

### 10.3 基础设施优化
- 负载均衡配置
- 自动扩缩容
- 数据库读写分离
- 缓存集群部署
- 全球CDN分发

---

## 11. 部署与发布

### 11.1 CI/CD流程
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Run tests
        run: npm test
      - name: Run linting
        run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker images
        run: |
          docker build -t cargo-frontend ./frontend
          docker build -t cargo-auth ./services/auth
          docker build -t cargo-service ./services/cargo
          docker build -t cargo-feishu ./services/feishu
      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push cargo-frontend
          docker push cargo-auth
          docker push cargo-service
          docker push cargo-feishu

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          # 使用SSH部署到生产服务器
          ssh ${{ secrets.PRODUCTION_SSH }} << 'EOF'
            cd /opt/cargo-platform
            docker-compose pull
            docker-compose up -d
          EOF
```

### 11.2 数据库迁移
```sql
-- 版本控制迁移脚本
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 示例迁移脚本
-- migrations/001_create_initial_schema.sql
INSERT INTO schema_migrations (version) VALUES ('001_create_initial_schema');
```

---

## 12. 维护与扩展

### 12.1 日常维护任务
- 监控告警处理
- 日志分析和清理
- 性能指标检查
- 安全补丁更新
- 数据备份验证

### 12.2 扩展性考虑
- 微服务独立扩展
- 数据库分片策略
- 缓存水平扩展
- 消息队列扩容
- 全球多区域部署

### 12.3 技术债务管理
- 定期代码重构
- 依赖项更新
- 性能瓶颈识别
- 架构演进规划
- 文档维护更新

---

## 总结

本技术架构重构方案旨在将当前的简单Python服务演进为现代化的微服务架构，通过引入容器化、服务网格、监控告警等云原生技术，构建一个高可用、高性能、易扩展的货源管理平台。整个架构设计遵循以下原则：

1. **高内聚低耦合**：服务职责清晰，便于独立开发和部署
2. **可扩展性**：支持水平扩展和垂直扩展
3. **高可用性**：通过冗余和故障转移保证服务连续性
4. **安全性**：多层安全防护，保障数据和应用安全
5. **可维护性**：完善的监控、日志和告警体系

通过实施本方案，预期能够：
- 提升系统可用性至99.9%以上
- 支持万级并发用户访问
- 实现秒级API响应时间
- 降低运维成本30%以上
- 为业务快速发展提供强有力的技术支撑