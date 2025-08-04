export default function HomePage() {
  return (
    <div style={{ fontFamily: 'sans-serif', textAlign: 'center', marginTop: '50px' }}>
      <h1>cha-line...</h1>
      <p>cha-line 기동중...</p>
      <p>cha-line起動中...</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        <li><code>/api/test-line</code></li>
        <li><code>/api/test-scrape</code></li>
      </ul>
    </div>
  );
}
