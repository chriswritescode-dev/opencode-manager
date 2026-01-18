"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var react_1 = require("@testing-library/react");
var useGit_1 = require("./useGit");
var gitApi = require("../api/git");
var toast = require("../lib/toast");
var react_query_1 = require("@tanstack/react-query");
vitest_1.vi.mock('../api/git', function () { return ({
    gitFetch: vitest_1.vi.fn(),
    gitPull: vitest_1.vi.fn(),
    gitPush: vitest_1.vi.fn(),
    gitCommit: vitest_1.vi.fn(),
    gitStageFiles: vitest_1.vi.fn(),
    gitUnstageFiles: vitest_1.vi.fn(),
    fetchGitLog: vitest_1.vi.fn(),
    fetchGitDiff: vitest_1.vi.fn(),
    createBranch: vitest_1.vi.fn(),
    switchBranch: vitest_1.vi.fn(),
}); });
vitest_1.vi.mock('../lib/toast', function () { return ({
    showToast: {
        success: vitest_1.vi.fn(),
        error: vitest_1.vi.fn(),
        info: vitest_1.vi.fn(),
        warning: vitest_1.vi.fn(),
        loading: vitest_1.vi.fn(),
        promise: vitest_1.vi.fn(),
        dismiss: vitest_1.vi.fn(),
    },
}); });
var mockInvalidateQueries = vitest_1.vi.fn();
vitest_1.vi.mock('@tanstack/react-query', function () { return __awaiter(void 0, void 0, void 0, function () {
    var actual;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, vitest_1.vi.importActual('@tanstack/react-query')];
            case 1:
                actual = _a.sent();
                return [2 /*return*/, __assign(__assign({}, actual), { useQueryClient: vitest_1.vi.fn(function () { return ({
                            invalidateQueries: mockInvalidateQueries
                        }); }) })];
        }
    });
}); });
var createWrapper = function () {
    var queryClient = new react_query_1.QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });
    return function (_a) {
        var children = _a.children;
        return (<react_query_1.QueryClientProvider client={queryClient}>{children}</react_query_1.QueryClientProvider>);
    };
};
(0, vitest_1.describe)('useGit', function () {
    (0, vitest_1.beforeEach)(function () {
        vitest_1.vi.clearAllMocks();
        mockInvalidateQueries.mockClear();
    });
    (0, vitest_1.it)('returns all mutations', function () {
        var result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
        (0, vitest_1.expect)(result.current).toHaveProperty('fetch');
        (0, vitest_1.expect)(result.current).toHaveProperty('pull');
        (0, vitest_1.expect)(result.current).toHaveProperty('push');
        (0, vitest_1.expect)(result.current).toHaveProperty('commit');
        (0, vitest_1.expect)(result.current).toHaveProperty('stageFiles');
        (0, vitest_1.expect)(result.current).toHaveProperty('unstageFiles');
        (0, vitest_1.expect)(result.current).toHaveProperty('log');
        (0, vitest_1.expect)(result.current).toHaveProperty('diff');
    });
    (0, vitest_1.describe)('fetch mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.fetch.mutateAsync();
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitFetch).toHaveBeenCalledWith(1);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitFetch, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitFetch = vitest_1.vi.mocked(gitApi.gitFetch);
                        mockGitFetch.mockRejectedValue('Fetch failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.fetch.mutateAsync().catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Fetch failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    (0, vitest_1.describe)('pull mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.pull.mutateAsync();
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitPull).toHaveBeenCalledWith(1);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitPull, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitPull = vitest_1.vi.mocked(gitApi.gitPull);
                        mockGitPull.mockRejectedValue('Pull failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.pull.mutateAsync().catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Pull failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    (0, vitest_1.describe)('push mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.push.mutateAsync();
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitPush).toHaveBeenCalledWith(1);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitPush, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitPush = vitest_1.vi.mocked(gitApi.gitPush);
                        mockGitPush.mockRejectedValue('Push failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.push.mutateAsync().catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Push failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    (0, vitest_1.describe)('commit mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.commit.mutateAsync({ message: 'test commit' });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitCommit).toHaveBeenCalledWith(1, 'test commit', undefined);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitCommit, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitCommit = vitest_1.vi.mocked(gitApi.gitCommit);
                        mockGitCommit.mockRejectedValue('Commit failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.commit.mutateAsync({ message: 'test' }).catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Commit failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    (0, vitest_1.describe)('stageFiles mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.stageFiles.mutateAsync(['file.txt']);
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitStageFiles).toHaveBeenCalledWith(1, ['file.txt']);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitStageFiles, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitStageFiles = vitest_1.vi.mocked(gitApi.gitStageFiles);
                        mockGitStageFiles.mockRejectedValue('Stage failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.stageFiles.mutateAsync(['file.txt']).catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Stage failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    (0, vitest_1.describe)('unstageFiles mutation', function () {
        (0, vitest_1.it)('calls correct API and invalidates queries on success', function () { return __awaiter(void 0, void 0, void 0, function () {
            var result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.unstageFiles.mutateAsync(['file.txt']);
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(gitApi.gitUnstageFiles).toHaveBeenCalledWith(1, ['file.txt']);
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitStatus', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['fileDiff', 1] });
                        (0, vitest_1.expect)(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['gitLog', 1] });
                        return [2 /*return*/];
                }
            });
        }); });
        (0, vitest_1.it)('shows toast error on failure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var mockGitUnstageFiles, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mockGitUnstageFiles = vitest_1.vi.mocked(gitApi.gitUnstageFiles);
                        mockGitUnstageFiles.mockRejectedValue('Unstage failed');
                        result = (0, react_1.renderHook)(function () { return (0, useGit_1.useGit)(1); }, { wrapper: createWrapper() }).result;
                        return [4 /*yield*/, (0, react_1.waitFor)(function () {
                                result.current.unstageFiles.mutateAsync(['file.txt']).catch(function () { });
                            })];
                    case 1:
                        _a.sent();
                        (0, vitest_1.expect)(toast.showToast.error).toHaveBeenCalledWith('Unstage failed');
                        return [2 /*return*/];
                }
            });
        }); });
    });
});
