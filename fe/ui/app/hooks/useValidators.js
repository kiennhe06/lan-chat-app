import { useMemo } from 'react';
import { getApi } from '../api/apiClient.js';

/**
 * Hàm validate/normalize thuần từ preload (shared/validators.js).
 * Mỗi hàm normalize trả {ok:true, value} | {ok:false, error}.
 */
export function useValidators() {
  return useMemo(() => getApi().validators, []);
}
