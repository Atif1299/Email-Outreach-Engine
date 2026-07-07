export default function ProductFrame({
  url = 'app.emailoutreach.engine/dashboard',
  children,
}: {
  url?: string
  children: React.ReactNode
}) {
  return (
    <div className="m-product-frame">
      <div className="m-product-chrome">
        <span className="m-product-dot" />
        <span className="m-product-dot" />
        <span className="m-product-dot" />
        <span className="m-product-url">{url}</span>
      </div>
      <div className="m-product-body">{children}</div>
    </div>
  )
}
