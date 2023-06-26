{{/*
Common labels
*/}}
{{- define "ctx.ReleaseName" -}}
{{- $ctx := required "ctx specified in dict" (get . "ctx") -}}
{{ $ctx.Release.Name }}
{{- end }}

{{- define "component" -}}
{{ required "component specified in dict" (get . "component") }}
{{- end }}

{{- define "component.domain" -}}
{{ required "domain specified in dict" (get . "domain") }}
{{- end }}

{{- define "component.chart" -}}
{{- $ctx := required "ctx specified in dict" (get . "ctx") -}}
{{- printf "%s-%s-%s" $ctx.Chart.Name $ctx.Chart.Version (include "component" .) | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{- define "port" -}}
{{ required "port specified in dict" (get . "port") }}
{{- end }}


{{/* Selector labels */}}
{{- define "component.selectorLabels" -}}
app.kubernetes.io/name: {{ include "component.fullname" . }}
app.kubernetes.io/instance: {{ include "ctx.ReleaseName" . }}
{{- end }}

{{/* Labels */}}
{{- define "component.labels" -}}
{{- $ctx := required "ctx specified in dict" (get . "ctx") -}}
{{- $domain := get . "domain" -}}
{{- if $domain }}
helm.hash.ai/domain: {{ $domain | quote }}
{{- end }}
helm.sh/chart: {{ include "component.chart" . }}
{{ include "component.selectorLabels" . }}
{{- if $ctx.Chart.AppVersion }}
app.kubernetes.io/version: {{ $ctx.Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ $ctx.Release.Service }}
{{- end }}


{{/* Liveness probe settings */}}
{{- define "probe-threshold-nodejs" -}}
failureThreshold: 3
periodSeconds: 15
initialDelaySeconds: 20
{{- end }}

{{- define "probe-kratos-threshold" -}}
failureThreshold: 3
periodSeconds: 10
successThreshold: 1
timeoutSeconds: 1
{{- end}}

{{- define "probe-threshold-fast" -}}
# 6 seconds total
failureThreshold: 3
periodSeconds: 2
initialDelaySeconds: 2
{{- end }}

{{- define "pg-ready-init-container"}}
- name: init-postgres-dependency
  image: postgres:14-alpine3.16
  command: ["sh", "-c", 
          "until pg_isready -h {{ .Values.pg.host }}.$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace).svc.cluster.local -p {{ .Values.pg.port }}; 
          do echo waiting for database; sleep 2; done;"]
{{- end }}


{{- define "component.fullname" -}}
{{- printf "%s-%s" (include "ctx.ReleaseName" .) (include "component" .) }}
{{- end -}}


{{- define "serviceHost" -}}
{{- printf "%s-%s" 
      (include "ctx.ReleaseName" .) 
      (include "component" .) }}
{{- end -}}


{{- define "serviceUrl" -}}
{{- printf "http://%s:%s" 
      ( .serviceDns )
      (include "port" .) }}
{{- end -}}
