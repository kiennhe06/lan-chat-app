import { useMemo } from 'react';
import { getApi } from '../api/apiClient.js';
import C from '../config/constants.js';

/**
 * Ghi log client (JSONL local + ship lên server qua main). Lỗi ghi log chỉ cảnh báo console,
 * không làm hỏng luồng UI.
 * @returns {{ log: (level:string, category:string, action:string, meta?:object) => void,
 *   info: Function, warn: Function, error: Function }}
 */
export function useLogger() {
  return useMemo(() => {
    const log = (level, category, action, meta) => {
      try {
        getApi()
          .logs.write(level, category, action, meta)
          .catch((err) => console.warn('[useLogger] Không ghi được log', action, err));
      } catch (err) {
        console.warn('[useLogger] Không ghi được log', action, err);
      }
    };
    return {
      log,
      info: (category, action, meta) => log(C.LOG_LEVEL.INFO, category, action, meta),
      warn: (category, action, meta) => log(C.LOG_LEVEL.WARN, category, action, meta),
      error: (category, action, meta) => log(C.LOG_LEVEL.ERROR, category, action, meta),
    };
  }, []);
}
