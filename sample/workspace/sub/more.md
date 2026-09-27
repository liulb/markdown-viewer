# 多级目录示例

这一页位于子目录 `sub/` 中，用于验证文件树的**多级分组**与相对路径解析。

- 跳转到[示例工作区首页](../index.md)
- 跳转到[设计说明](../notes.md)

## 表格

| 层级 | 路径 | 说明 |
| --- | --- | --- |
| 根 | `index.md` | 工作区首页 |
| 根 | `notes.md` | 设计说明 |
| 子目录 | `sub/more.md` | 当前页面 |

代码块也可以正常高亮：

```ts
type WorkspaceFile = {
  path: string;          // 工作区相对路径
  handle: FileSystemFileHandle;
};

const find = (files: WorkspaceFile[], name: string) =>
  files.find(f => f.path.endsWith(name));
```
