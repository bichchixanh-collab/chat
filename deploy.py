#!/usr/bin/env python3
"""
deploy.py — Công cụ dọn / đẩy code lên GitHub repo.

Đặt file này trong thư mục gốc chứa code (cùng cấp với index.html, vercel.json, ...),
rồi chạy:

    python deploy.py

Script sẽ hỏi username + tên repo GitHub, sau đó cho chọn:
  1 = Xoá sạch repo GitHub (xoá hết file trên remote bằng 1 commit rỗng)
      và xoá luôn thư mục .git ở local để làm sạch lịch sử git cũ trong máy.
  2 = Push toàn bộ code đang có trong thư mục này lên lại repo (git init nếu
      chưa có, add toàn bộ file, commit, và force-push lên nhánh main).

Yêu cầu:
  - Đã cài Git và đã đăng nhập (git credential) hoặc dùng Personal Access Token.
  - Máy có thể kết nối tới github.com.
"""

import os
import shutil
import stat
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def _on_rm_error(func, path, exc_info):
    """
    Xử lý lỗi khi xoá file .git trên Windows: Git đánh dấu nhiều file bên trong
    .git/objects là read-only, khiến os.remove/shutil.rmtree mặc định bị từ
    chối quyền (PermissionError / WinError 5). Gỡ thuộc tính read-only rồi
    thử xoá lại.
    """
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def safe_rmtree(path):
    """rmtree an toàn trên cả Windows lẫn Linux/Mac, tự gỡ read-only nếu cần."""
    if os.path.exists(path):
        shutil.rmtree(path, onerror=_on_rm_error)


def run(cmd, check=True, capture=False):
    """Chạy 1 lệnh shell, in ra lệnh đang chạy để dễ theo dõi.
    Luôn in stdout/stderr thật của lệnh (kể cả khi capture=False) để không
    bao giờ mất thông tin lỗi chi tiết từ Git.
    """
    print(f"$ {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=REPO_ROOT,
                             capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip())
    if check and result.returncode != 0:
        sys.exit(f"❌ Lệnh thất bại (exit code {result.returncode}): {cmd}")
    return result


def run_in(cmd, cwd, check=True):
    """Giống run() nhưng cho chạy trong 1 thư mục cwd chỉ định khác REPO_ROOT
    (dùng cho thao tác trong thư mục tạm khi wipe repo). Luôn in đầy đủ
    stdout/stderr thật của lệnh.
    """
    print(f"$ {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print(result.stderr.strip())
    if check and result.returncode != 0:
        sys.exit(f"❌ Lệnh thất bại (exit code {result.returncode}): {cmd}")
    return result


def check_git_installed():
    if shutil.which("git") is None:
        sys.exit("❌ Chưa cài Git. Cài Git rồi chạy lại script này.")


def confirm(prompt):
    ans = input(f"{prompt} (gõ 'yes' để xác nhận): ").strip().lower()
    return ans == "yes"


def wipe_remote_repo(remote_url):
    """
    Xoá sạch nội dung repo GitHub từ xa bằng cách push 1 commit rỗng
    (orphan branch) đè lên nhánh main, sau đó xoá .git local.
    """
    print("\n⚠️  Thao tác này sẽ XOÁ SẠCH toàn bộ file và lịch sử commit trên GitHub repo.")
    print(f"    Remote: {remote_url}")
    if not confirm("Bạn có chắc chắn muốn xoá sạch repo này không?"):
        print("Đã huỷ.")
        return

    tmp_dir = os.path.join(REPO_ROOT, ".__wipe_tmp__")
    safe_rmtree(tmp_dir)
    os.makedirs(tmp_dir)

    try:
        # Tạo 1 repo tạm trống, commit rỗng, force push đè lên remote.
        # Toàn bộ thao tác git ở đây chạy trong tmp_dir, không đụng tới
        # thư mục code hiện tại (REPO_ROOT).
        run_in("git init", tmp_dir)
        run_in("git checkout --orphan empty-branch", tmp_dir)
        readme_path = os.path.join(tmp_dir, "README.md")
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write("# Repo đã được làm sạch\n")
        run_in("git add -A", tmp_dir)
        run_in('git commit -m "Wipe repo"', tmp_dir)
        run_in(f'git remote add origin "{remote_url}"', tmp_dir)
        run_in("git branch -M main", tmp_dir)
        run_in("git push origin main --force", tmp_dir)
        print("✅ Đã xoá sạch nội dung + lịch sử commit trên GitHub repo.")
    finally:
        safe_rmtree(tmp_dir)

    # Xoá .git local trong thư mục code hiện tại (nếu có) để làm sạch lịch sử local
    local_git = os.path.join(REPO_ROOT, ".git")
    if os.path.exists(local_git):
        if confirm("Xoá luôn thư mục .git trong thư mục code hiện tại (local)?"):
            safe_rmtree(local_git)
            print("✅ Đã xoá .git local. Lần sau chọn '2' để push code mới, script sẽ tự git init lại.")
    else:
        print("ℹ️  Thư mục code hiện tại chưa có .git, không cần xoá.")


def check_default_credentials_warning():
    """
    Cảnh báo (không chặn) nếu phát hiện tinyfilemanager.php còn dùng tài khoản/
    mật khẩu mặc định công khai từ mã nguồn gốc — nếu deploy công khai với
    mật khẩu này, bất kỳ ai cũng đăng nhập được và toàn quyền sửa/xoá file
    trên server.
    """
    tfm_path = os.path.join(REPO_ROOT, "tinyfilemanager.php")
    if not os.path.exists(tfm_path):
        return
    try:
        with open(tfm_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return
    # Hash mặc định công khai của tài khoản admin/admin@123 và user/12345
    # trong mã nguồn gốc Tiny File Manager.
    default_hashes = [
        "$2y$10$/K.hjNr84lLNDt8fTXjoI.DBp6PpeyoJ.mGwrrLuCZfAwfSAGqhOW",
        "$2y$10$Fg6Dz8oH9fPoZ2jJan5tZuv6Z4Kp7avtQ9bDfrdRntXtPeiMAZyGO",
    ]
    if any(h in content for h in default_hashes):
        print("\n⚠️  CẢNH BÁO BẢO MẬT: tinyfilemanager.php vẫn đang dùng mật khẩu")
        print("   MẶC ĐỊNH công khai (admin/admin@123 hoặc user/12345). Nếu file")
        print("   này được push lên và deploy công khai, BẤT KỲ AI cũng đăng nhập")
        print("   được và toàn quyền xem/sửa/xoá mọi file trên server.")
        print("   Nên đổi mật khẩu trong file này trước khi domain đi vào hoạt")
        print("   động thật — script vẫn tiếp tục push theo yêu cầu của bạn.")
        confirm("Đã đọc cảnh báo, tiếp tục push")


SENSITIVE_FILENAMES = {
    "config.php", ".env", ".env.local", ".env.production",
    "secrets.json", "credentials.json", "serviceAccountKey.json",
}


def ensure_gitignore_has_secrets():
    """
    Đảm bảo các file nhạy cảm phổ biến (config.php, .env...) luôn nằm trong
    .gitignore trước khi push, để không bao giờ vô tình commit token/mật khẩu
    thật lên GitHub. Chỉ thêm dòng nếu file đó thực sự tồn tại trong thư mục
    và chưa có sẵn trong .gitignore.
    """
    gitignore_path = os.path.join(REPO_ROOT, ".gitignore")
    existing_lines = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r", encoding="utf-8") as f:
            existing_lines = [l.strip() for l in f.readlines()]

    to_add = []
    for fname in sorted(SENSITIVE_FILENAMES):
        file_path = os.path.join(REPO_ROOT, fname)
        if os.path.exists(file_path) and fname not in existing_lines:
            to_add.append(fname)

    if to_add:
        print("\n🔒 Phát hiện file nhạy cảm chưa có trong .gitignore:")
        for fname in to_add:
            print(f"   - {fname}")
        if confirm("Tự động thêm các file này vào .gitignore để không bị lộ token/mật khẩu lên GitHub?"):
            with open(gitignore_path, "a", encoding="utf-8") as f:
                if existing_lines and existing_lines[-1] != "":
                    f.write("\n")
                for fname in to_add:
                    f.write(fname + "\n")
            print("✅ Đã cập nhật .gitignore.")
            print("⚠️  Lưu ý: nếu file này ĐÃ TỪNG được commit trước đây, thêm vào")
            print("   .gitignore chỉ ngăn commit MỚI, không xoá nó khỏi lịch sử cũ.")
            print("   Nếu Git đã có lịch sử commit chứa các file này, cần xoá hẳn")
            print("   thư mục .git (mất lịch sử) để loại bỏ triệt để, hoặc dùng")
            print("   'git filter-repo' / BFG Repo-Cleaner để lọc riêng file đó ra")
            print("   khỏi lịch sử mà không mất các commit khác.")
        else:
            print("⚠️  Bỏ qua — nếu các file này từng/đang chứa token thật, GitHub")
            print("   Push Protection có thể sẽ chặn push nếu phát hiện secret.")


def push_code(remote_url):
    """
    Push toàn bộ code đang có trong thư mục chứa script này lên repo GitHub,
    ghi đè nhánh main (force push).
    """
    print(f"\n📦 Chuẩn bị push toàn bộ code trong:\n    {REPO_ROOT}\n  lên: {remote_url}")
    if not confirm("Xác nhận push (sẽ FORCE PUSH, ghi đè nhánh main trên remote)?"):
        print("Đã huỷ.")
        return

    ensure_gitignore_has_secrets()
    check_default_credentials_warning()

    git_dir = os.path.join(REPO_ROOT, ".git")
    if not os.path.exists(git_dir):
        run("git init")
        run("git branch -M main")

    # Đảm bảo remote "origin" trỏ đúng repo mong muốn
    result = run("git remote", capture=True, check=False)
    if "origin" in result.stdout.split():
        run(f'git remote set-url origin "{remote_url}"')
    else:
        run(f'git remote add origin "{remote_url}"')

    run("git add -A")

    # Nếu không có gì để commit thì bỏ qua bước commit, tránh lỗi "nothing to commit"
    diff_check = run("git diff --cached --quiet", check=False)
    if diff_check.returncode != 0:
        commit_msg = input("Nhập nội dung commit (Enter để dùng mặc định): ").strip()
        if not commit_msg:
            commit_msg = "Update code"
        run(f'git commit -m "{commit_msg}"')
    else:
        print("ℹ️  Không có thay đổi mới để commit, sẽ vẫn thử push nhánh hiện có.")

    run("git branch -M main")
    push_result = run("git push origin main --force", check=False)
    if push_result.returncode != 0:
        combined_output = (push_result.stdout or "") + (push_result.stderr or "")
        if "GH013" in combined_output or "push protection" in combined_output.lower():
            print("\n🔒 GitHub CHẶN push vì phát hiện secret (token/API key) nằm")
            print("   trong lịch sử commit đang được push (xem chi tiết ở trên,")
            print("   dòng 'locations:' cho biết chính xác file + commit chứa nó).")
            print("   Cách xử lý:")
            print("   1. Thu hồi (revoke) ngay token đó tại nơi đã cấp nó.")
            print("   2. Xoá giá trị thật khỏi file, thêm file đó vào .gitignore.")
            print(f"   3. Xoá thư mục .git trong {REPO_ROOT} để xoá sạch lịch sử")
            print("      cũ đang chứa token (rmdir /s /q .git trên Windows), rồi")
            print("      chạy lại script này và chọn '2' để push lại từ đầu.")
        else:
            print("\n❌ Push thất bại. Một số nguyên nhân thường gặp:")
            print("   • Chưa đăng nhập / sai quyền truy cập repo GitHub — thử đăng")
            print("     nhập lại bằng: git credential-manager github login")
            print("     hoặc dùng Personal Access Token thay mật khẩu khi Git hỏi.")
            print("   • Repo GitHub chưa tồn tại — vào github.com tạo repo")
            print(f"     '{remote_url}' trước (không cần thêm README/license mặc định).")
            print("   • Repo là private và tài khoản đang đăng nhập không có quyền push.")
            print("   • Mất kết nối mạng tới github.com.")
        sys.exit("Xem chi tiết lỗi Git ở phía trên để biết chính xác nguyên nhân.")
    print("✅ Đã push code lên GitHub thành công.")


def main():
    check_git_installed()
    print("=== Công cụ dọn / đẩy code lên GitHub ===")
    print(f"Thư mục làm việc: {REPO_ROOT}\n")

    username = input("Nhập username GitHub: ").strip()
    reponame = input("Nhập tên repo: ").strip()

    if not username or not reponame:
        sys.exit("❌ Username hoặc tên repo không được để trống.")

    remote_url = f"https://github.com/{username}/{reponame}.git"
    print(f"\nRepo đích: {remote_url}")

    print("\nChọn thao tác:")
    print("  1 = Xoá sạch repo GitHub (và xoá .git local)")
    print("  2 = Push code trong thư mục này lên lại repo")
    choice = input("Nhập lựa chọn (1/2): ").strip()

    if choice == "1":
        wipe_remote_repo(remote_url)
    elif choice == "2":
        push_code(remote_url)
    else:
        sys.exit("❌ Lựa chọn không hợp lệ. Chỉ nhập 1 hoặc 2.")


if __name__ == "__main__":
    main()
