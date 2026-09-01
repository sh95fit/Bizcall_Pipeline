/**
 * categoryColors.ts
 *
 * 카테고리 ID(UUID)를 해시하여 HSL 색상을 동적으로 생성하는 유틸.
 *
 * - 팔레트 크기 제한 없음 → 상위 카테고리가 몇 개 추가되어도 자동 대응
 * - 동일 ID → 항상 동일 색상 (해시 기반이므로 순서 무관)
 * - DB 스키마 변경 불필요
 *
 * 색상 전략:
 *   hue        : ID 해시값 % 360  (색상환 전체 사용)
 *   saturation : 65%              (너무 탁하거나 원색이 되지 않도록 고정)
 *   lightness  : bg 92%, text 30%, border 78%  (파스텔 배경 + 진한 텍스트)
 */

/**
 * 문자열 → 정수 해시 (djb2 변형)
 * UUID는 항상 고유하므로 충돌 가능성 매우 낮음
 */
function hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash)
      hash |= 0 // 32bit 정수로 변환
    }
    return Math.abs(hash)
  }
  
  /**
   * 카테고리 ID로부터 hue(0~359)를 계산
   */
  function getHue(id: string): number {
    return hashCode(id) % 360
  }
  
  /**
   * CategoryBadge 인라인 스타일 객체를 반환.
   * Tailwind JIT는 동적 색상을 지원하지 않으므로 style prop으로 적용.
   *
   * 사용 예)
   *   <span style={getCategoryStyle(id)}>{name}</span>
   */
  export function getCategoryStyle(id: string): React.CSSProperties {
    const hue = getHue(id)
    return {
      backgroundColor: `hsl(${hue}, 65%, 92%)`,
      color:           `hsl(${hue}, 60%, 30%)`,
      border:          `1px solid hsl(${hue}, 55%, 78%)`,
    }
  }