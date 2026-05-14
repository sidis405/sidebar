import { useEffect, useMemo, useRef, useState } from "react";
import { type NodeApi, type NodeRendererProps, Tree } from "react-arborist";
import { fileIconSvg, folderIconSvg } from "./icons.ts";
import type { TreeNode } from "../shared/protocol.ts";

export type FileTreeProps = {
  nodes: TreeNode[];
  selectedPath: string | null;
  onOpen: (path: string) => void;
  onNewFile: (parent: string, name: string) => void;
  onNewFolder: (parent: string, name: string) => void;
  onRename: (from: string, to: string) => void;
  /** confirmIfDirty=true when the file at `path` has an unsaved buffer. */
  onDelete: (path: string, confirmIfDirty: boolean) => void;
  /** Set of paths whose buffers are currently dirty (used by delete confirm). */
  dirtyPaths: ReadonlySet<string>;
};

type MenuState = {
  x: number;
  y: number;
  target: TreeNode;
};

export function FileTree(props: FileTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 300, h: 600 });

  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const data = useMemo(() => props.nodes, [props.nodes]);

  const onContextMenu = (e: React.MouseEvent, node: NodeApi<TreeNode>) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target: node.data });
  };

  const onBackgroundContext = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-tree-row]")) return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { id: "", name: "", path: "", kind: "dir" },
    });
  };

  return (
    <div
      className="file-tree"
      ref={treeContainerRef}
      onContextMenu={onBackgroundContext}
    >
      <div className="file-tree-header">workspace</div>
      <Tree
        data={data}
        width={size.w}
        height={size.h - 30}
        rowHeight={24}
        indent={16}
        idAccessor={(n) => n.id || n.path || "__root__"}
        selection={props.selectedPath ?? undefined}
        openByDefault
      >
        {(rowProps) => (
          <Row
            {...rowProps}
            onOpen={props.onOpen}
            onContextMenu={onContextMenu}
            dirtyPaths={props.dirtyPaths}
          />
        )}
      </Tree>
      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onAction={(action) => {
            const target = menu.target;
            setMenu(null);
            const parentPath = target.kind === "dir" ? target.path : parentOf(target.path);
            switch (action) {
              case "new-file": {
                const name = window.prompt("new file name (must end in .md)", "untitled.md");
                if (name) props.onNewFile(parentPath, name);
                return;
              }
              case "new-folder": {
                const name = window.prompt("new folder name", "section");
                if (name) props.onNewFolder(parentPath, name);
                return;
              }
              case "rename": {
                if (!target.path) return;
                const next = window.prompt("new name", target.name);
                if (!next || next === target.name) return;
                const newPath = parentOf(target.path)
                  ? `${parentOf(target.path)}/${next}`
                  : next;
                props.onRename(target.path, newPath);
                return;
              }
              case "delete": {
                if (!target.path) return;
                const isDirty = props.dirtyPaths.has(target.path);
                props.onDelete(target.path, isDirty);
                return;
              }
            }
          }}
        />
      )}
    </div>
  );
}

type RowProps = NodeRendererProps<TreeNode> & {
  onOpen: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: NodeApi<TreeNode>) => void;
  dirtyPaths: ReadonlySet<string>;
};

function Row({ node, style, onOpen, onContextMenu, dirtyPaths }: RowProps) {
  const isFile = node.data.kind === "file";
  const isOpen = node.isOpen;
  const iconSvg = isFile
    ? fileIconSvg(node.data.name)
    : folderIconSvg(node.data.name, isOpen);
  return (
    <div
      data-tree-row
      className={`row${node.isSelected ? " selected" : ""}`}
      style={style}
      onClick={() => {
        if (isFile) onOpen(node.data.path);
        else node.toggle();
      }}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <span className="row-icon" dangerouslySetInnerHTML={{ __html: iconSvg }} />
      <span className="row-name">{node.data.name || "/"}</span>
      {isFile && dirtyPaths.has(node.data.path) && <span className="row-dirty">●</span>}
    </div>
  );
}

type ContextMenuProps = {
  state: MenuState;
  onClose: () => void;
  onAction: (a: "new-file" | "new-folder" | "rename" | "delete") => void;
};

function ContextMenu({ state, onAction }: ContextMenuProps) {
  const hasTarget = !!state.target.path;
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => onAction("new-file")}>new file</button>
      <button onClick={() => onAction("new-folder")}>new folder</button>
      <button disabled={!hasTarget} onClick={() => onAction("rename")}>
        rename
      </button>
      <button disabled={!hasTarget} onClick={() => onAction("delete")}>
        delete
      </button>
    </div>
  );
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
