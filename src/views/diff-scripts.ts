export function renderDiffScripts(): string {
  return `
    <script>
      (function() {
        // View toggle (unified vs split)
        const toggleButtons = document.querySelectorAll('.diff-toggle-btn');
        const diffFiles = document.querySelectorAll('.diff-file');
        
        toggleButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            
            // Update active state
            toggleButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Toggle views
            diffFiles.forEach(file => {
              const unifiedView = file.querySelector('.diff-unified-view');
              const splitView = file.querySelector('.diff-split-view');
              
              if (unifiedView && splitView) {
                if (view === 'unified') {
                  unifiedView.style.display = 'block';
                  splitView.style.display = 'none';
                } else {
                  unifiedView.style.display = 'none';
                  splitView.style.display = 'block';
                }
              }
            });
          });
        });
        
        // Collapse/expand files
        const collapseButtons = document.querySelectorAll('.diff-collapse-btn');
        
        collapseButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            const fileIndex = btn.dataset.file;
            const fileElement = document.getElementById('diff-file-' + fileIndex);
            
            if (fileElement) {
              const isCollapsed = fileElement.classList.contains('collapsed');
              const icon = btn.querySelector('.collapse-icon');
              
              if (isCollapsed) {
                fileElement.classList.remove('collapsed');
                icon.textContent = '−';
              } else {
                fileElement.classList.add('collapsed');
                icon.textContent = '+';
              }
            }
          });
        });
      })();
    </script>
  `;
}
