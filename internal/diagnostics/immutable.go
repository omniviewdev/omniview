package diagnostics

func copySnapshot(in Snapshot) Snapshot {
	out := in
	out.Metrics = make([]Metric, len(in.Metrics))
	for i, m := range in.Metrics {
		out.Metrics[i] = m
		out.Metrics[i].Points = make([]Point, len(m.Points))
		for j, p := range m.Points {
			out.Metrics[i].Points[j] = p
			point := &out.Metrics[i].Points[j]
			point.Attributes = make(map[string]string, len(p.Attributes))
			for k, v := range p.Attributes {
				point.Attributes[k] = v
			}
			point.Bounds = append([]float64{}, p.Bounds...)
			point.BucketCounts = append([]uint64{}, p.BucketCounts...)
		}
	}
	return out
}
func copySnapshots(in []Snapshot) []Snapshot {
	out := make([]Snapshot, len(in))
	for i := range in {
		out[i] = copySnapshot(in[i])
	}
	return out
}
func clone[T any](value T) T {
	var out any
	switch v := any(value).(type) {
	case Snapshot:
		out = copySnapshot(v)
	case History:
		v.Samples = copySnapshots(v.Samples)
		out = v
	case Capture:
		v.Samples = copySnapshots(v.Samples)
		out = v
	default:
		panic("unsupported diagnostics immutable copy")
	}
	return out.(T)
}
