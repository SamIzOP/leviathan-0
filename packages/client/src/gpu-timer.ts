export class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active?: WebGLQuery;
  ms: number | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin() {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (q) {
      this.active = q;
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    }
  }
  end() {
    if (this.active && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = undefined;
    }
    const q = this.pending[0];
    if (
      q &&
      this.ext &&
      this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)
    ) {
      if (!this.gl.getParameter(this.ext.GPU_DISJOINT_EXT))
        this.ms = this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6;
      this.gl.deleteQuery(q);
      this.pending.shift();
    }
  }
  dispose() {
    this.pending.forEach((q) => this.gl.deleteQuery(q));
    this.pending = [];
  }
}
