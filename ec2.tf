# --- AMI Deep Learning Ubuntu (GPU/NVIDIA ready via SSM) ---
data "aws_ssm_parameter" "dlami_gpu_ubuntu_2204" {
  name = "/aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id"
}

# --- Security Group minimal (OpenWebUI seulement en acces externe) ---
resource "aws_security_group" "ec2_min" {
  name        = "${var.project}-sg-ec2"
  description = "SG minimal pour EC2"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.project}-sg-ec2" })
}

# --- IAM: role pour SSM (connexion sans SSH) ---
data "aws_iam_policy_document" "ssm_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ssm_role" {
  name               = "${var.project}-${terraform.workspace}-ec2-ssm-role"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume_role.json
  tags               = var.tags
}

# Politique geree par AWS pour SSM
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# (Optionnel) CloudWatch Logs pour agent SSM
resource "aws_iam_role_policy_attachment" "cw_agent" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "ssm_profile" {
  name = "${var.project}-${terraform.workspace}-ec2-ssm-profile"
  role = aws_iam_role.ssm_role.name
  tags = var.tags
}

# --- Locals: catalogue de modeles & user_data ---
locals {
  ai_catalog = {
    qwen-mini            = { pull = "qwen2.5:0.5b" }
    llama3-1b            = { pull = "llama3.2:1b" }
    phi3-mini            = { pull = "phi3:mini" }
    phi4-mini            = { pull = "phi4-mini" }
    qwen-7b              = { pull = "qwen2.5:7b" }
    qwen-14b             = { pull = "qwen2.5:14b" }
    qwen-coder-14b       = { pull = "qwen2.5-coder:14b" }
    gpt-oss              = { pull = "gpt-oss:20b" }
    gpt-oss-20b          = { pull = "gpt-oss:20b" }
    mistral-small-24b    = { pull = "mistral-small3.2:24b" }
    dolphin3-8b          = { pull = "dolphin3:8b" }
    llama2-uncensored-7b = { pull = "llama2-uncensored:7b" }
  }

  selected_ai         = local.ai_catalog[var.ai_choice]
  is_gpu_instance     = can(regex("^(g|p)[0-9].*", var.instance_type))
  effective_webui_url = trimspace(var.workspace_url) != "" ? trimspace(var.workspace_url) : "http://127.0.0.1:3000"
  trusted_header_env = var.auth_mode == "trusted_header" ? join("\n", [
    "      -e WEBUI_AUTH_TRUSTED_EMAIL_HEADER=${var.trusted_email_header} \\",
    "      -e WEBUI_AUTH_TRUSTED_NAME_HEADER=${var.trusted_name_header} \\",
    "      -e WEBUI_AUTH_TRUSTED_GROUPS_HEADER=${var.trusted_groups_header} \\",
    "      -e WEBUI_AUTH_TRUSTED_ROLE_HEADER=${var.trusted_role_header} \\"
  ]) : "      \\"

  # Dimensionnement disque par modele (GiB) pour eviter les saturations.
  model_disk_gb = {
    qwen-mini            = 100
    llama3-1b            = 100
    phi3-mini            = 100
    phi4-mini            = 100
    qwen-7b              = 120
    qwen-14b             = 160
    qwen-coder-14b       = 180
    gpt-oss              = 220
    gpt-oss-20b          = 220
    mistral-small-24b    = 260
    dolphin3-8b          = 140
    llama2-uncensored-7b = 140
  }

  computed_root_volume_size_gb = max(
    var.root_volume_size_gb,
    lookup(local.model_disk_gb, var.ai_choice, var.root_volume_size_gb)
  )

  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl gnupg jq awscli snapd

    # Docker: eviter le conflit docker.io <-> containerd.io
    if ! command -v docker >/dev/null 2>&1; then
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin || \
      apt-get install -y docker.io
    fi

    # SSM agent pour la connexion sans SSH (Ubuntu)
    # On force un setup robuste: refresh snap, puis fallback service apt si necessaire.
    if snap list amazon-ssm-agent >/dev/null 2>&1; then
      snap refresh amazon-ssm-agent --stable || true
    else
      snap install amazon-ssm-agent --classic || true
    fi

    if systemctl list-unit-files | grep -q '^snap.amazon-ssm-agent.amazon-ssm-agent.service'; then
      systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service || true
    fi

    if ! systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service; then
      apt-get install -y amazon-ssm-agent || true
      systemctl enable --now amazon-ssm-agent || true
    fi

    systemctl enable --now docker

    if [ "${local.is_gpu_instance}" = "true" ]; then
      # Runtime NVIDIA pour Docker (les drivers sont deja presents dans la DLAMI)
      curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        gpg --batch --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
      curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

      apt-get update
      apt-get install -y nvidia-container-toolkit
      nvidia-ctk runtime configure --runtime=docker
      systemctl restart docker
    fi

    docker volume create ollama-data
    docker volume create open-webui-data
    docker network create ai-stack || true

    # OpenWebUI ecrit sa base SQLite dans ce volume; on ouvre les permissions pour eviter
    # les echecs "internal error during signup" sur certaines images/UID.
    OPENWEBUI_VOL_PATH=$(docker volume inspect -f '{{ .Mountpoint }}' open-webui-data || true)
    if [ -n "$OPENWEBUI_VOL_PATH" ]; then
      mkdir -p "$OPENWEBUI_VOL_PATH"
      chmod 0777 "$OPENWEBUI_VOL_PATH" || true
    fi

    # Ollama avec acces GPU NVIDIA
    if [ "${local.is_gpu_instance}" = "true" ]; then
      docker run -d --name ollama \
        --network ai-stack \
        --gpus all \
        -e OLLAMA_KEEP_ALIVE=24h \
        -e OLLAMA_LOAD_TIMEOUT=15m \
        -p 0.0.0.0:11434:11434 \
        -v ollama-data:/root/.ollama \
        --restart unless-stopped \
        ${var.ollama_image}
    else
      docker run -d --name ollama \
        --network ai-stack \
        -e OLLAMA_KEEP_ALIVE=24h \
        -e OLLAMA_LOAD_TIMEOUT=15m \
        -p 0.0.0.0:11434:11434 \
        -v ollama-data:/root/.ollama \
        --restart unless-stopped \
        ${var.ollama_image}
    fi

    # Attendre que l'API Ollama soit up
    for i in {1..90}; do
      curl -fsS http://127.0.0.1:11434/api/version && break
      sleep 2
    done

    # OpenWebUI connecte a Ollama
    docker run -d --name open-webui \
      --network ai-stack \
      -p 0.0.0.0:3000:8080 \
      -e ENABLE_OLLAMA_API=true \
      -e ENABLE_SIGNUP=false \
      -e ENABLE_SIGNUP_PASSWORD_CONFIRMATION=true \
      -e ENABLE_PASSWORD_VALIDATION=true \
      -e PASSWORD_VALIDATION_REGEX_PATTERN='^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}$' \
      -e PASSWORD_VALIDATION_HINT='Minimum 8 caracteres avec majuscule, minuscule et chiffre.' \
      -e WEBUI_SECRET_KEY='${var.webui_secret_key}' \
      -e WEBUI_ADMIN_EMAIL='${var.owui_email}' \
      -e WEBUI_ADMIN_PASSWORD='${var.owui_password}' \
      -e WEBUI_ADMIN_NAME='${var.owui_name}' \
      -e WEBUI_URL='${local.effective_webui_url}' \
      -e CORS_ALLOW_ORIGIN='*' \
      -e ENABLE_WEBSOCKET_SUPPORT=true \
      -e ENABLE_PERSISTENT_CONFIG=false \
      -e OLLAMA_BASE_URL=http://ollama:11434 \
      -e OLLAMA_BASE_URLS=http://ollama:11434 \
      ${local.trusted_header_env}
      -v open-webui-data:/app/backend/data \
      --restart unless-stopped \
      ${var.open_webui_image}

    # Attendre que OpenWebUI reponde (evite les faux negatifs de readiness).
    for i in {1..120}; do
      if curl -fsSI http://127.0.0.1:3000/ >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done

    # Pull du modele choisi (non-stream pour eviter un flux JSON massif dans les logs cloud-init).
    pull_ok=0
    for i in {1..5}; do
      if curl -fsS -X POST http://127.0.0.1:11434/api/pull -d '{"name":"${local.selected_ai.pull}","stream":false}' >/tmp/ollama-pull.json; then
        pull_ok=1
        break
      fi
      sleep 10
    done

    # Fallback CLI si l'endpoint HTTP pull echoue (reseau instable, connexion coupee, etc.).
    if [ "$pull_ok" -ne 1 ]; then
      if docker exec ollama ollama pull "${local.selected_ai.pull}" >/tmp/ollama-pull-cli.log 2>&1; then
        pull_ok=1
      else
        echo "WARN: Pull Ollama echoue apres retries HTTP + fallback CLI; OpenWebUI reste disponible." >&2
      fi
    fi

    model_ready=0
    if [ "$pull_ok" -eq 1 ]; then
      for i in {1..30}; do
        if curl -fsS http://127.0.0.1:11434/api/tags | jq -e --arg m "${local.selected_ai.pull}" 'any(.models[]?; .name == $m)' >/dev/null; then
          model_ready=1
          break
        fi
        sleep 2
      done
    fi

    if [ "$model_ready" -ne 1 ]; then
      echo "WARN: Le modele ${local.selected_ai.pull} n apparait pas encore dans /api/tags." >&2
    else
      # Force OpenWebUI a recharger la liste des modeles apres un gros pull.
      docker restart open-webui >/dev/null 2>&1 || true
    fi

    # Warmup: force un premier chargement modele pour reduire la latence du 1er prompt.
    # Ne pas bloquer tout le deploiement si le warmup echoue (modele trop lourd ou timeout).
    if [ "$pull_ok" -eq 1 ] && [ "$model_ready" -eq 1 ]; then
      warmup_ok=0
      for i in {1..10}; do
        if curl -fsS -X POST http://127.0.0.1:11434/api/generate \
          -d '{"model":"${local.selected_ai.pull}","prompt":"ping","stream":false,"keep_alive":"24h","options":{"num_predict":8}}' \
          >/tmp/ollama-warmup.json; then
          warmup_ok=1
          break
        fi
        sleep 5
      done

      if [ "$warmup_ok" -ne 1 ]; then
        echo "WARN: Warmup Ollama echoue apres 10 tentatives; OpenWebUI reste disponible." >&2
      fi
    else
      echo "WARN: Warmup saute car modele non disponible localement." >&2
    fi

    # Tag EC2
    IID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)

    aws ec2 create-tags --region "$REGION" --resources "$IID" \
      --tags Key=AI,Value=ready Key=OllamaModel,Value=${local.selected_ai.pull} Key=UI,Value=open-webui || true

  EOT
}

# --- Instance EC2 ---
resource "aws_instance" "ai_host" {
  ami                                  = data.aws_ssm_parameter.dlami_gpu_ubuntu_2204.value
  instance_type                        = var.instance_type
  subnet_id                            = aws_subnet.public_a.id
  vpc_security_group_ids               = [aws_security_group.ec2_min.id]
  iam_instance_profile                 = aws_iam_instance_profile.ssm_profile.name
  associate_public_ip_address          = true
  disable_api_termination              = false
  instance_initiated_shutdown_behavior = "terminate"

  # Augmentation du disque root
  root_block_device {
    volume_size           = local.computed_root_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data                   = local.user_data
  user_data_replace_on_change = true

  timeouts {
    create = "45m"
    delete = "45m"
  }

  tags = merge(var.tags, {
    Name          = "${var.project}-${var.workspace_slug}"
    Role          = "ai"
    Purpose       = "temporary-team-workspace"
    WorkspaceName = var.workspace_name
    WorkspaceSlug = var.workspace_slug
    SessionTtlH   = tostring(var.session_ttl_hours)
    TeamSizeHint  = tostring(var.team_size_hint)
    AuthMode      = var.auth_mode
  })
}

resource "aws_iam_role_policy" "tag_self" {
  name = "${var.project}-${terraform.workspace}-ec2-tag-self"
  role = aws_iam_role.ssm_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid      = "TagSelf",
        Effect   = "Allow",
        Action   = ["ec2:CreateTags", "ec2:DescribeInstances"],
        Resource = "*"
      }
    ]
  })
}
