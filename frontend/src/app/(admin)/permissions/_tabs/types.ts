/**
 * Permissions 탭들이 공유하는 타입 정의.
 *
 * page.tsx + 각 _tabs/*.tsx에서 import해 사용.
 * 새 공통 타입은 여기 추가.
 */

export interface PermissionItem {
  id: number;
  key: string;
  display_name: string;
  category: string;
  super_admin_only: boolean;
}

export interface PositionTemplate {
  id: number;
  key: string;
  display_name: string;
  description: string | null;
  category: string;
  is_system: boolean;
  permission_keys: string[];
  permission_count: number;
  assignment_count: number;
}
