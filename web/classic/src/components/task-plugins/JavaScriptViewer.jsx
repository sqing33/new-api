/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// 只读 JS 源码查看器：classic 前端未引入 CodeMirror，
// 用等宽 pre + 行号展示，效果一致且零依赖
const JavaScriptViewer = ({ value = '', className = '' }) => {
  const lines = value ? value.split('\n') : [''];
  return (
    <pre
      className={`overflow-auto rounded-md border bg-black/[0.02] dark:bg-black/20 ${className}`}
      style={{ height: '100%' }}
    >
      <code className='block px-3 py-2 font-mono text-xs leading-5 whitespace-pre'>
        {lines.map((line, index) => (
          <div key={index} className='table-row'>
            <span className='table-cell select-none pr-3 text-right text-neutral-400 w-8'>
              {index + 1}
            </span>
            <span className='table-cell'>{line || ' '}</span>
          </div>
        ))}
      </code>
    </pre>
  );
};

export default JavaScriptViewer;
