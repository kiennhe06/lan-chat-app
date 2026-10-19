import { useMemo } from 'react';
import { getApi } from '../../app/api/apiClient.js';

/**
 * URL hiển thị ảnh/avatar qua custom protocol `lcfile://` (cache offline do main phục vụ).
 * @returns {{ thumbUrl: (sha256:string)=>string, imageUrl: (sha256:string)=>string,
 *   avatarUrl: (name:string|null)=>string, saveImage: (sha256:string, name:string)=>Promise<any> }}
 */
export function useMediaUrls() {
  return useMemo(() => {
    const file = () => getApi().file;
    return {
      thumbUrl: (sha256) => (sha256 ? file().thumbUrl(sha256) : ''),
      imageUrl: (sha256) => (sha256 ? file().imageUrl(sha256) : ''),
      avatarUrl: (name) => (name ? file().avatarUrl(name) : ''),
      saveImage: (sha256, name) => file().saveImage(sha256, name),
    };
  }, []);
}
