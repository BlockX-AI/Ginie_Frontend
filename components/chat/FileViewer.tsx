"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  FileCode,
  Folder,
  ChevronRight,
  ChevronDown,
  Download,
  Loader2,
  FolderArchive,
} from "lucide-react";
// Backend disabled: no API client
import { api } from "@/lib/api";

const Editor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default || mod),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-white/60" />
      </div>
    ),
  }
);

interface FileViewerProps {
  files: string[];
  projectId: string;
  localFileContent?: Record<string, string>;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }).map(n => n.children ? { ...n, children: sortNodes(n.children) } : n);
}

function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];

  files.forEach((filePath) => {
    const parts = filePath.split("/");
    let currentLevel = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath += (index === 0 ? "" : "/") + part;
      const isLastPart = index === parts.length - 1;

      let existingNode = currentLevel.find((node) => node.name === part);

      if (!existingNode) {
        existingNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLastPart,
          children: !isLastPart ? [] : undefined,
        };
        currentLevel.push(existingNode);
      }

      if (!isLastPart && existingNode.children) {
        currentLevel = existingNode.children;
      }
    });
  });

  return sortNodes(root);
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    css: "css",
    scss: "scss",
    sol: "solidity",
    py: "python",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    xml: "xml",
    sh: "shell",
  };

  return languageMap[ext || ""] || "plaintext";
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const colorMap: Record<string, string> = {
    tsx: "text-blue-400",
    ts: "text-blue-400",
    jsx: "text-cyan-400",
    js: "text-yellow-400",
    css: "text-pink-400",
    json: "text-green-400",
    html: "text-orange-400",
    sol: "text-purple-400",
    md: "text-gray-400",
    py: "text-blue-300",
  };

  return (
    <FileCode className={`w-4 h-4 ${colorMap[ext || ""] || "text-white/60"}`} />
  );
}

function FileTreeNode({
  node,
  onSelectFile,
  selectedFile,
  depth = 0,
}: {
  node: FileNode;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(depth === 0);

  const isSelected = selectedFile === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors ${
          isSelected
            ? "bg-blue-500/20 border-l-2 border-blue-400"
            : "hover:bg-white/5"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.isDirectory) {
            setIsExpanded(!isExpanded);
          } else {
            onSelectFile(node.path);
          }
        }}
      >
        {node.isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-white/40" />
            ) : (
              <ChevronRight className="w-4 h-4 text-white/40" />
            )}
            <Folder className="w-4 h-4 text-yellow-400/80" />
            <span className="text-sm text-white/80 font-medium">
              {node.name}
            </span>
          </>
        ) : (
          <>
            <div className="w-4" />
            {getFileIcon(node.name)}
            <span className="text-sm text-white/70">{node.name}</span>
          </>
        )}
      </div>

      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileViewer({ files, projectId, localFileContent }: FileViewerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileTree = buildFileTree(files);

  const fetchFileContent = async (filePath: string) => {
    // Check local overrides first (e.g. contract source/ABI)
    if (localFileContent && localFileContent[filePath] != null) {
      setFileContent(localFileContent[filePath]);
      return;
    }
    setIsLoadingFile(true);
    try {
      const res = await api.demoProjectFile(projectId, filePath);
      const content = (res as any)?.content;
      setFileContent(typeof content === "string" ? content : "");
    } catch (e: any) {
      setFileContent(`// Failed to load file: ${e?.message || "unknown error"}`);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleSelectFile = (filePath: string) => {
    setSelectedFile(filePath);
    fetchFileContent(filePath);
  };

  const handleDownloadFile = async () => {
    if (!selectedFile) return;

    try {
      const blob = new Blob([fileContent], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedFile.split("/").pop() || "file.txt";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Failed to download file:", error);
    }
  };

  const handleDownloadAll = async () => {
    setIsDownloading(true);
    try {
      const ab = await api.demoProjectZip(projectId);
      const blob = new Blob([ab], { type: "application/zip" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectId}-project.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setIsDownloading(false);
    }
  };

  // Auto-select first file
  useEffect(() => {
    if (files.length > 0 && !selectedFile) {
      const firstFile =
        files.find((f) => !f.includes("/") || f.split("/").length === 1) ||
        files[0];
      handleSelectFile(firstFile);
    }
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/40">
        <FileCode className="w-12 h-12 mb-4" />
        <p className="text-sm">No files available yet</p>
        <p className="text-xs mt-1">Files will appear once your app is built</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* File Tree Sidebar */}
      <div className="w-64 border-r border-white/10 overflow-y-auto bg-black/30">
        <div className="sticky top-0 bg-black/50 backdrop-blur-sm border-b border-white/10 p-3 z-10">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white/90 font-semibold text-sm">Files</h3>
            <button
              onClick={handleDownloadAll}
              disabled={isDownloading}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors disabled:opacity-50"
              title="Download all files as ZIP"
            >
              {isDownloading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FolderArchive className="w-3 h-3" />
              )}
              ZIP
            </button>
          </div>
          <p className="text-white/50 text-xs">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="p-2">
          {fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              onSelectFile={handleSelectFile}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            {/* Editor Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-black/30 border-b border-white/10">
              <div className="flex items-center gap-2">
                {getFileIcon(selectedFile)}
                <span className="text-sm text-white/80 font-mono">
                  {selectedFile}
                </span>
              </div>
              <button
                onClick={handleDownloadFile}
                className="flex items-center gap-2 px-3 py-1 text-xs bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded transition-colors"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            </div>

            {/* Monaco Editor */}
            <div className="flex-1 relative">
              {isLoadingFile ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                </div>
              ) : (
                <Editor
                  height="100%"
                  language={getLanguageFromPath(selectedFile)}
                  value={fileContent}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    padding: { top: 16, bottom: 16 },
                  }}
                  loading={
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                    </div>
                  }
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-white/40">
            <div className="text-center">
              <FileCode className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Select a file to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
