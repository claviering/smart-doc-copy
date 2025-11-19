// ==UserScript==
// @name         Smart-Docs Copy to Clipboard
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Copy smart-docs API documentation sections as markdown
// @author       You
// @match        *://*/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Only run on pages that look like smart-docs
    if (!document.querySelector('.sect2')) {
        return;
    }

    // CSS for copy button
    const style = document.createElement('style');
    style.textContent = `
        .smartdoc-copy-btn {
            margin-left: 10px;
            padding: 4px 12px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            transition: all 0.3s ease;
            opacity: 0;
            pointer-events: none;
        }
        .smartdoc-copy-btn.visible {
            opacity: 1;
            pointer-events: auto;
        }
        .smartdoc-copy-btn:hover {
            background: #45a049;
            transform: scale(1.05);
        }
        .smartdoc-copy-btn:active {
            transform: scale(0.95);
        }
        .smartdoc-copy-btn.copied {
            background: #2196F3;
        }
    `;
    document.head.appendChild(style);

    // Parse table to JSON example with comments
    function tableToJsonExample(table) {
        if (!table) return '';

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        if (rows.length === 0) return '';

        let jsonLines = [];
        
        rows.forEach((row, index) => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= 3) {
                const paramName = cells[0].textContent.trim();
                const paramType = cells[1].textContent.trim();
                const description = cells[2].textContent.trim();
                const example = cells.length > 5 ? cells[5].textContent.trim() : '';
                
                // Determine example value based on type
                let value;
                if (example && example !== '-' && example !== '') {
                    // Use provided example
                    if (paramType === 'boolean') {
                        value = example;
                    } else if (paramType.includes('int') || paramType.includes('long') || paramType.includes('double') || paramType.includes('float')) {
                        value = example;
                    } else {
                        value = `"${example}"`;
                    }
                } else {
                    // Use default value based on type
                    if (paramType === 'boolean') {
                        value = 'true';
                    } else if (paramType.includes('int') || paramType.includes('long') || paramType.includes('double') || paramType.includes('float')) {
                        value = '0';
                    } else {
                        value = '""';
                    }
                }
                
                const comment = description && description !== '-' ? ` // ${description}` : '';
                // Add comma after value, before comment (except for last item)
                const comma = index < rows.length - 1 ? ',' : '';
                jsonLines.push(`  "${paramName}": ${value}${comma}${comment}`);
            }
        });

        return '\n```json\n{\n' + jsonLines.join('\n') + '\n}\n```\n';
    }

    // Helper function to map Java types to TypeScript types
    function mapJavaTypeToTS(paramType) {
        if (paramType.includes('int') || paramType.includes('long') || paramType.includes('double') || paramType.includes('float')) {
            return 'number';
        } else if (paramType === 'boolean') {
            return 'boolean';
        } else if (paramType === 'array' || paramType.includes('[]')) {
            return 'Array<any>';
        } else if (paramType === 'object') {
            return 'object';
        } else if (paramType === 'enum') {
            return 'string';
        } else {
            return 'string';
        }
    }

    // Extract JSON from response example
    function extractResponseJson(sect2) {
        const responseExampleHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Response-example')
        );
        
        if (responseExampleHeader) {
            const listingBlock = responseExampleHeader.parentElement.parentElement.nextElementSibling;
            if (listingBlock?.classList.contains('listingblock')) {
                const codeBlock = listingBlock.querySelector('.content code');
                if (codeBlock) {
                    return codeBlock.textContent.trim();
                }
            }
        }
        return null;
    }

    // Extract JSON from request example
    function extractRequestJson(sect2) {
        const requestExampleHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Request-example')
        );
        
        if (requestExampleHeader) {
            const listingBlock = requestExampleHeader.parentElement.parentElement.nextElementSibling;
            if (listingBlock?.classList.contains('listingblock')) {
                const codeBlock = listingBlock.querySelector('.content code');
                if (codeBlock) {
                    const fullText = codeBlock.textContent.trim();
                    // Extract JSON from curl command (look for --data '...')
                    const dataMatch = fullText.match(/--data\s+['"]({[\s\S]*?})['"]$/m);
                    if (dataMatch) {
                        return dataMatch[1].trim();
                    }
                }
            }
        }
        return null;
    }

    // Add comments to request/body JSON based on body-parameters table
    function addCommentsToBodyJson(jsonStr, table) {
        if (!jsonStr || !table) return jsonStr;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        
        // Build a map of field paths to descriptions
        const fieldDescriptions = new Map();
        
        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= 4) {
                const fieldName = cells[0].textContent.trim();
                let description = cells[2].textContent.trim();
                const required = cells[3].textContent.trim();
                
                // Remove "No comments found." and "响应数据" from description
                if (description === 'No comments found.' || description === '响应数据') {
                    description = '';
                }
                
                // Clean description - replace newlines with spaces for single-line comments
                description = description.replace(/\n/g, ' ').trim();
                
                // Build comment with description and required info
                let comment = '';
                if (description) {
                    comment = description;
                }
                
                // Add required info
                if (required === 'true' || required === 'false') {
                    if (comment) {
                        comment += ', ';
                    }
                    comment += `Required ${required}`;
                }
                
                if (comment) {
                    fieldDescriptions.set(fieldName, comment);
                }
            }
        });

        let commentedJson = jsonStr;

        // Add comments to matching fields
        fieldDescriptions.forEach((description, fieldName) => {
            // Match the field in JSON and add comment, preserving commas
            const fieldRegex = new RegExp(`("${fieldName}"\\s*:\\s*)([^,\\n}\\]]+)(,?)`, 'g');
            commentedJson = commentedJson.replace(fieldRegex, (match, prefix, value, comma) => {
                return `${prefix}${value}${comma} // ${description}`;
            });
        });

        return commentedJson;
    }

    // Add comments to response JSON based on response-fields table
    function addCommentsToResponseJson(jsonStr, table) {
        if (!jsonStr || !table) return jsonStr;

        const rows = Array.from(table.querySelectorAll('tbody tr'));
        
        // Build a map of field paths to descriptions
        const fieldDescriptions = new Map();
        
        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length >= 3) {
                const fieldName = cells[0].textContent.trim();
                const description = cells[2].textContent.trim();
                
                // Skip "No comments found." and "响应数据"
                if (description && description !== '-' && description !== 'No comments found.' && description !== '响应数据') {
                    // Clean field name (remove tree symbols)
                    const cleanName = fieldName.replace(/^[└─\s&nbsp;]+/, '');
                    fieldDescriptions.set(cleanName, description);
                }
            }
        });

        let commentedJson = jsonStr;

        // Add comments to matching fields
        fieldDescriptions.forEach((description, fieldName) => {
            // Match the field in JSON and add comment, preserving commas
            // Pattern: "fieldName": value, or "fieldName": value\n or "fieldName": value}
            const fieldRegex = new RegExp(`("${fieldName}"\\s*:\\s*)([^,\\n}\\]]+)(,?)`, 'g');
            commentedJson = commentedJson.replace(fieldRegex, (match, prefix, value, comma) => {
                return `${prefix}${value}${comma} // ${description}`;
            });
        });

        return commentedJson;
    }

    // Convert sect2 section to markdown
    function sectionToMarkdown(sect2) {
        let markdown = '';

        // Get the title from h3
        const h3 = sect2.querySelector('h3');
        const titleLink = h3?.querySelector('a.link');
        const title = titleLink ? titleLink.textContent.trim() : (h3?.textContent.trim() || 'API Documentation');

        // Extract URL
        const urlDiv = sect2.querySelector('[data-url]');
        const url = urlDiv?.getAttribute('data-url') || '';
        const urlText = urlDiv?.textContent.replace('URL:', '').trim() || '';

        // Extract method
        const methodDiv = sect2.querySelector('[data-method]');
        const method = methodDiv?.getAttribute('data-method') || 'GET';

        // Extract Content-Type
        const contentTypeDiv = sect2.querySelector('[data-content-type]');
        const contentType = contentTypeDiv?.getAttribute('data-content-type') || '';

        // Extract description
        const descDiv = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Description')
        )?.parentElement.parentElement;
        const description = descDiv?.textContent.replace('Description:', '').trim() || '';

        // Build markdown header
        markdown += `# ${title}\n`;
        if (url) markdown += `* URL: ${url}\n`;
        if (method) markdown += `* Method: ${method}\n`;
        if (contentType) markdown += `* Content-Type: ${contentType}\n`;
        if (description) markdown += `* Description: ${description}\n`;

        // Extract Query-parameters (for GET requests)
        const queryParamsHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Query-parameters')
        );
        if (queryParamsHeader) {
            markdown += '\n## Query-parameters:\n';
            const table = queryParamsHeader.parentElement.parentElement.nextElementSibling;
            if (table?.tagName === 'TABLE') {
                markdown += tableToJsonExample(table);
                markdown += '\n* add typescript interface for parameter\n';
            }
        }

        // Extract Body-parameters (for POST requests)
        const bodyParamsHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Body-parameters')
        );
        if (bodyParamsHeader) {
            markdown += '\n## Body-parameters:\n';
            const table = bodyParamsHeader.parentElement.parentElement.nextElementSibling;
            
            // Try to get request example JSON first (for nested structures)
            let requestJson = extractRequestJson(sect2);
            
            if (requestJson && table?.tagName === 'TABLE') {
                // Add comments to request JSON
                requestJson = addCommentsToBodyJson(requestJson, table);
                markdown += '\n```json\n' + requestJson + '\n```\n';
            } else if (table?.tagName === 'TABLE') {
                // Fallback to generating JSON from table (for simple structures)
                markdown += tableToJsonExample(table);
            }
            
            markdown += '\n* add typescript interface for parameter\n';
        }

        // Extract Path-parameters
        const pathParamsHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Path-parameters')
        );
        if (pathParamsHeader) {
            markdown += '\n## Path-parameters:\n';
            const table = pathParamsHeader.parentElement.parentElement.nextElementSibling;
            if (table?.tagName === 'TABLE') {
                markdown += tableToJsonExample(table);
                markdown += '\n* add typescript interface for parameter\n';
            }
        }

        // Extract Response-fields
        const responseFieldsHeader = Array.from(sect2.querySelectorAll('div > p > strong')).find(
            strong => strong.textContent.includes('Response-fields')
        );
        if (responseFieldsHeader) {
            markdown += '\n## Response-fields:\n';
            
            // Get response example JSON
            let responseJson = extractResponseJson(sect2);
            const table = responseFieldsHeader.parentElement.parentElement.nextElementSibling;
            
            if (responseJson && table?.tagName === 'TABLE') {
                // Add comments to response JSON
                responseJson = addCommentsToResponseJson(responseJson, table);
                markdown += '\n```json\n' + responseJson + '\n```\n';
                markdown += '\n* add typescript interface for response, if it is js file, add jsdoc comments for response\n';
            } else if (table?.tagName === 'TABLE') {
                // Fallback to generating JSON from table
                markdown += tableToJsonExample(table);
                markdown += '\n* add typescript interface for response, if it is js file, add jsdoc comments for response\n';
            }
        }

        return markdown;
    }

    // Copy to clipboard
    function copyToClipboard(text, button) {
        try {
            // Try using GM_setClipboard first (more reliable in Tampermonkey)
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(text);
                showCopiedFeedback(button);
            } else {
                // Fallback to Clipboard API
                navigator.clipboard.writeText(text).then(() => {
                    showCopiedFeedback(button);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                    alert('Failed to copy to clipboard');
                });
            }
        } catch (err) {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
        }
    }

    // Show copied feedback
    function showCopiedFeedback(button) {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
    }

    // Create copy button for a section
    function createCopyButton(sect2, h3) {
        // set h3 style display to flex
        h3.style.display = 'flex';
        h3.style.alignItems = 'center';
        // Check if button already exists
        if (h3.querySelector('.smartdoc-copy-btn')) {
            return null;
        }

        const button = document.createElement('button');
        button.className = 'smartdoc-copy-btn';
        button.textContent = 'Copy';
        button.setAttribute('aria-label', 'Copy section as markdown');
        
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const markdown = sectionToMarkdown(sect2);
            copyToClipboard(markdown, button);
        });

        return button;
    }

    // Use IntersectionObserver for performance
    const observerOptions = {
        root: null,
        rootMargin: '50px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const button = entry.target.querySelector('.smartdoc-copy-btn');
            if (!button) return;

            if (entry.isIntersecting) {
                // Element is in viewport
                button.classList.add('visible');
            } else {
                // Element is out of viewport
                button.classList.remove('visible');
            }
        });
    }, observerOptions);

    // Initialize: add buttons to all sect2 sections
    function init() {
        const sections = document.querySelectorAll('.sect2');
        
        sections.forEach(sect2 => {
            const h3 = sect2.querySelector('h3');
            if (!h3) return;

            const linkElement = h3.querySelector('a.link');
            if (!linkElement) return;

            const button = createCopyButton(sect2, h3);
            if (button) {
                linkElement.parentElement.appendChild(button);
                // Observe the h3 element
                observer.observe(h3);
            }
        });

        console.log(`Smart-Docs Copy: Initialized ${sections.length} sections`);
    }

    // Run initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Watch for dynamically added content
    const mutationObserver = new MutationObserver((mutations) => {
        let shouldReinit = false;
        
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && (node.classList?.contains('sect2') || node.querySelector?.('.sect2'))) {
                    shouldReinit = true;
                }
            });
        });

        if (shouldReinit) {
            init();
        }
    });

    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
