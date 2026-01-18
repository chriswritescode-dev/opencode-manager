"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var utils_1 = require("./utils");
(0, vitest_1.describe)('sanitizeForTTS', function () {
    (0, vitest_1.it)('should handle headers', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('# Main Header\n## Sub Header\n### Detail')).toBe('Main Header\nSub Header\nDetail');
    });
    (0, vitest_1.it)('should handle bullet lists', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('- Milk\n- Eggs\n* Bread')).toBe('Milk\nEggs\nBread');
    });
    (0, vitest_1.it)('should handle numbered lists', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('1. First\n2. Second')).toBe('First\nSecond');
    });
    (0, vitest_1.it)('should remove inline code but keep content', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Use `const x = 1` here')).toBe('Use const x = 1 here');
    });
    (0, vitest_1.it)('should remove code blocks entirely', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Start\n```\ncode\n```\nEnd')).toBe('Start\nEnd');
    });
    (0, vitest_1.it)('should handle bold formatting', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('This is **bold** text')).toBe('This is bold text');
    });
    (0, vitest_1.it)('should handle italic formatting', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Simple *italic* example')).toBe('Simple italic example');
    });
    (0, vitest_1.it)('should remove markdown links but keep display text', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Visit [OpenCode](https://opencode.ai)')).toBe('Visit OpenCode');
    });
    (0, vitest_1.it)('should handle images and tables', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('See ![diagram](url) below:\n|A|B|\n|-|-|\n|1|2|')).toBe('See diagram below:\nA B\n1 2');
    });
    (0, vitest_1.it)('should handle blockquotes', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('> Important\n> Note')).toBe('Important\nNote');
    });
    (0, vitest_1.it)('should remove citations and footnotes', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('See [1] and [^2] for more')).toBe('See and for more');
    });
    (0, vitest_1.it)('should handle strikethrough', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('~~removed~~')).toBe('removed');
    });
    (0, vitest_1.it)('should handle complex mixed content', function () {
        var input = '# Results\nFunction: `calc()`\nSee [doc](url):\n- A\n- B';
        var expected = 'Results\nFunction: calc()\nSee doc:\nA\nB';
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)(input)).toBe(expected);
    });
    (0, vitest_1.it)('should remove horizontal rules', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Before\n---\nAfter')).toBe('Before\nAfter');
    });
    (0, vitest_1.it)('should normalize whitespace', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Line 1\n\n\nLine 2')).toBe('Line 1\nLine 2');
    });
    (0, vitest_1.it)('should fix punctuation spacing', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Hello , world !')).toBe('Hello, world!');
    });
    (0, vitest_1.it)('should return empty string for empty input', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('')).toBe('');
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('   ')).toBe('');
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)(null)).toBe('');
    });
    (0, vitest_1.it)('should handle headers and lists combined', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('## Shopping List\n- Milk\n- Eggs')).toBe('Shopping List\nMilk\nEggs');
    });
    (0, vitest_1.it)('should handle HTML tags', function () {
        (0, vitest_1.expect)((0, utils_1.sanitizeForTTS)('Text with <tag>content</tag> here')).toBe('Text with content here');
    });
});
