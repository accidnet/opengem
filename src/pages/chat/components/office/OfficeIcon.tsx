type OfficeIconProps = { name: "focus" | "pointer" | "chat" | "info" | "home" | "cube" };

// 오피스 조작 아이콘은 외부 폰트 없이 오프라인에서도 표시합니다.
export function OfficeIcon({ name }: OfficeIconProps) {
  const paths = {
    focus: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    pointer: (
      <>
        <path d="m8 12 0-7a2 2 0 0 1 4 0v6l2-1 5 3-1 7H9l-5-7a2 2 0 0 1 3-2l1 1Z" />
      </>
    ),
    chat: <path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v.1" />
      </>
    ),
    home: (
      <>
        <path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" />
      </>
    ),
    cube: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5m-9 5L3 8m9 5v9" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
