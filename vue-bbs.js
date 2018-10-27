
const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')
const sqlite = require('sqlite')
const cookieParser = require('cookie-parser')
const multer = require('multer')
const svgCaptcha = require('svg-captcha');
const nodemailer = require('nodemailer');
const https = require('https')
const fs = require('fs')
const dbPromise = sqlite.open('./bbs.db', { Promise });
const upload = multer({dest: path.join(__dirname, 'user-uploaded')})
const port = 80
const app = express()
let db
let sessions = {}

// 美化 html 源代码
// app.locals.pretty = true
// 设置默认模板文件
// app.set('views', './views')


// 重定向 http 到 https
app.use((req, res, next) => {
  res.writeHead(301, {
      Location: `https://${req.headers.host}${req.url}`
  })
  res.end()
  next()
})

// 默认打开 static 下的 index.html
// 相对 http://localhost/static 
// app.use('/static', express.static('./static'))
app.use(express.static(path.join(__dirname, './static')))
app.use('/api/avatars', express.static('./user-uploaded'))
app.use(cookieParser('sdfghyhbvbnm'))
app.use(bodyParser.urlencoded())

app.use( function sessionMiddleware(req, res, next) {
  // console.log(req.cookies)
  if (!req.cookies.sessionId) {
    res.cookie('sessionId', Math.random().toString(32).slice(2))
  }
  next()
})

app.use( async (req, res, next) => {
  req.user = await db.get('SELECT avatar, id, username, timestamp FROM users WHERE id = ?', req.signedCookies.userId)
  // console.log(req.user)
  next()
})

//设置跨域访问
app.all('*', (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type");
    res.header("Access-Control-Allow-Methods","POST,GET,DELETE,OPTIONS");
    res.header("X-Powered-By",' 3.2.1')
    res.header("Content-Type", "application/json;charset=utf-8");

    // 设置前端携带可访问 cookies
    res.header("Access-Control-Allow-Origin", 'http://localhost:8080')
    // res.header("Access-Control-Allow-Origin", 'http://localhost:8080; http://127.0.0.1:8080; http://bbs2.iceeweb.com')
    res.header("Access-Control-Allow-Credentials", true)
    next();
});


// 主页
app.get('/api/posts', async (req, res, next) => {
  let posts = await db.all('SELECT posts.*, username, avatar FROM posts JOIN users WHERE posts.userId = users.id')
  // res.render('index.pug', {posts, user: req.user})
  res.jsonp({status: 200, data: {posts, user: req.user}})
})

// 帖子详情
app.get('/api/post/:postid', async (req, res, next)=> {

  let postid = req.params.postid
  let post = await db.get(
    'SELECT posts.*, username, avatar FROM posts JOIN users ON posts.userId = users.id WHERE posts.id = ?'
    , postid)

  if (post) {
    let comments = await db.all(
      `SELECT username, avatar, com.* FROM users join 
      (SELECT c.* FROM posts JOIN comments c ON posts.id = c.postId WHERE posts.id = ? ) com 
      where userId = users.id`
      , postid)

    // console.log('访问Post: ',post.id)
    // res.render('post.pug',{post,comments, user: req.user})
    res.jsonp({status: 200, data: {post, comments, user: req.user}})
  } else {
    res.jsonp({status: 403, data: {message: '你来到了知识的荒地', user: req.user}})
    // res.render('page-404.pug', {data :'你来到了知识的荒地 '})
  }
})

// 提交评论
app.post('/api/add-comment', async (req, res, next) => {
  let userId = req.signedCookies.userId

  if (userId) {
    let time = Date.now()
    await db.run(
    'INSERT INTO comments (postId, userId, content, timestamp) VALUES (?,?,?,?)',
    req.body.postid, userId, req.body.content, time)

    let cmtId = await db.get('SELECT id FROM comments where timestamp = ? and userId = ?', time, userId)
    res.jsonp({commentId: cmtId})
  } else {
    // res.render('page-404.pug', {data :'先登录后才可以发评论哦，快来试试吧 ^_^ '})
    res.jsonp({status: 403, data: {message: '先登录后才可以发评论哦，快来试试吧 ^_^ '}})
  }
})


// 个人主页
app.get('/api/user/:userid', async (req, res, next) => {
  let userid = req.params.userid
  let userinfo = await db.get(
    'SELECT users.id, users.username,users.avatar FROM users where id = ?'
    , userid
  )

  if (userinfo) {
    let posts = await db.all(
      'SELECT u.username, p.* from users u join posts p on u.id = p.userId where u.id = ?'
      , userid)  
    let comments = await db.all(
      `SELECT title postTitle, com.* from posts join 
      (SELECT u.username, c.* from users u join comments c on u.id = c.userId where u.id = ?) com 
      where com.postId = posts.id`
      , userid
    )
  
    res.jsonp({status: 200, data: {userinfo, posts, comments, user: req.user}})
  } else {

    res.jsonp({status: 403, data: {message: '当前用户不存在~~'}})
  }

})

// 注册
app.route('/api/register')
  .get((req, res, next) => {
    // res.render('register.pug', {user: req.user})
    res.jsonp({status: 200, data: {user: req.user}})
  })
  .post(upload.single('avatar'), async (req, res, next) => {
    // console.log(req.file)
    console.log(req.body, 'req.file:' + req.file != undefined)

    let isExistUser = await db.get( 
      'SELECT id FROM users WHERE username = ?', req.body.username )

    if (isExistUser) {
      // res.render('page-404.pug', {data :'这个名字已经被注册咯，换个试试吧 &_& '})
      res.status(403).send({message: '这个名字已经被注册咯，换个试试吧 &_& '})
    } else {
      if (!req.file) {
        req.file = await db.get('SELECT avatar FROM users WHERE username = ?', 'Avatar_2')
        req.file.filename = req.file.avatar 
      }
      await db.run(
        'INSERT INTO users (username, password, timestamp, avatar, email) VALUES (?, ?, ?, ?, ?)',
        req.body.username, req.body.password, Date.now(), req.file.filename, req.body.email)

      res.send({message: '注册成功'})
    }
  })

// 登录
app.route('/api/login')
  .get((req, res, next) => {
    // res.render('login.pug', {user: req.user})
    res.jsonp({status: 200, data: {user: req.user}})
  })
  .post( async (req, res, next) => {
    // 返回登录数据
    // console.log(req.body)

    if (req.body.captcha && sessions[req.cookies.sessionId] == req.body.captcha.toLowerCase()) {
      let user = await db.get(
        'SELECT id, username, avatar, timestamp FROM users WHERE username = ? and password = ?', req.body.username, req.body.password)
      if (user) {
        // console.log('登录成功')
        res.cookie('userId', user.id, {
          signed: true,
        })
        // res.redirect('/')
        console.log(req.body, '登录成功')
        res.send(user)
      } else {
        console.log(req.body, '登录失败，登入名||密码错啦')
        // res.render('page-404.pug', {data :'登入名、密码错啦, 再蒙一下 ~_~ '})
        res.status(403).send({message :'登入名、密码错啦, 再蒙一下 ~_~ '})
      }
      
    } else {
        console.log(req.body, '登录失败，验证码错啦')
      res.status(403).send({message :'验证码又输错啦, 一定是姿势不对 #_#'})
      // res.render('page-404.pug', {data :'验证码又输错啦, 一定是姿势不对 #_# '})
    }
  })

// 验证码
app.get('/api/captcha', (req, res, next) => {
  let captcha = svgCaptcha.create({
    color: true,
    noise: 2,
    ignoreChars: '0o1i',
    // background: '#cc9966'
  });
  sessions[req.cookies.sessionId] = captcha.text.toLowerCase()
  console.log('更新写入验证码：', sessions[req.cookies.sessionId])

  res.type('svg'); 
  res.status(200).send(captcha.data);
  // res.jsonp({status: 200, data: {data: captcha.data}});
  next()
})

// 登出
app.get('/api/logout', (req, res, next) => {
  console.log('登出成功')
  res.clearCookie('userId')
  res.send({message: '登出成功'})
})


// 发送 post 帖子
app.route('/api/add-post')
  .get((req, res, next) => {
    // res.render('add-post.pug', {user: req.user})
    res.jsonp({user: req.user})
  })
  .post( async (req, res, next) => {
    // 判断登录状态
    // console.log(req.signedCookies)
    let userId = req.signedCookies.userId

    if (userId) {
      await db.run('INSERT INTO posts (userId, title, content, timestamp) VALUES (?, ?, ?, ?)'
        , userId, req.body.title, req.body.content, Date.now())

      let post = await db.get('SELECT * FROM posts WHERE userId = ? ORDER BY timestamp DESC LIMIT 1', userId)

      // res.redirect('/api/post/' + postid.id)
      res.send({post: post})
    } else {
      // res.render('page-404.pug', {data :'请先登录后再发帖，谢谢 ^_^ '})
      res.status(403).send({message :'请先登录后再发帖，谢谢 ^_^ '})
    }
  })

  // 删除帖子
  app.get('/api/delete-post/:postid', async (req, res, next) => {
    let postId = req.params.postid
    let post = await db.get('SELECT * FROM posts WHERE id = ?', postId)

    if (req.user.id == post.userId) {
      await db.run('DELETE FROM posts WHERE id = ?', postId)
      res.send({message: '删除成功'})
    } else {
      // res.render('page-404.pug', {data :'您不能删除别人的帖子哦，发个帖子试试吧 ^_^ '})
      res.status(403).send({message :'您不能删除别人的帖子哦，发个帖子试试吧 ^_^ '})
    }
  })

  // 删除评论
  app.get('/api/delete-comment/:commentid', async (req, res, next) => {
    let commentId = req.params.commentid
    let comment = await db.get('SELECT * FROM comments WHERE id = ?', commentId)

    if (req.user.id == comment.userId) {
      await db.run('DELETE FROM comments WHERE id = ?', commentId)
      res.send({message: '删除成功'})
    } else {
      // res.render('page-404.pug', {data :'您不能删除别人的评论哦，发个评论试试吧 ^_^ '})
      res.status(403).send({message :'您不能删除别人的评论哦，发个评论试试吧 ^_^ '})
    }
  })
  
  // 404 page
  app.get('/api/page-404', (req, res, next) => {
    // res.render('page-404.pug', {data :'你来到了知识的荒地 '})
    res.jsonp({status: 403, data: {message :'你来到了知识的荒地'}})
  })

  // 忘记密码，发送邮件
  app.get('/api/forgot-password', (req, res, next) => {
    // res.render('send-email.pug')
  })
  
  app.route('/api/send-email')
    .get((req, res, next) => {
      // res.render('send-email.pug')
    })
    .post( async (req, res, next) => {
      console.log(req.body.username, req.body.email)

      let user = await db.get('SELECT * FROM users WHERE username = ? and email = ?'
        , req.body.username, req.body.email)

      if (user) {
        let emailFlag = Math.random().toString(32).slice(2)  + "username=" + encodeURI(user.username)
        let emailLocals = path.join(req.headers.origin, '/#/reset-password/', emailFlag)
        // console.log(emailLocals)
        // console.log(typeof(emailLocals))
        // console.log(emailLocals.replace(/\\/g,'/'))
        emailLocals = emailLocals.replace(/\\/g,'/')
        

        sessions[emailFlag] = emailFlag

        let transporter = nodemailer.createTransport({
          host: 'smtp.163.com',
          service: '163', // 使用了内置传输发送邮件 查看支持列表：https://nodemailer.com/smtp/well-known/
          port: 465, // SMTP 端口
          secureConnection: true, // 使用了 SSL
          auth: {
            user: 'iceesong@163.com',
            // 这里密码不是qq密码，是你设置的smtp授权码
            pass: 'bC3XpmsJ',
          }
        });
        
        let mailOptions = {
          from: '"轻论坛 " <iceesong@163.com>', // sender address
          to: user.email, // list of receivers
          // cc: '1299332802@qq.com',
          subject: '轻论坛 - 修改密码', // Subject line
          // 发送text或者html格式
          // text: 'Hello world?', // plain text body
          html: `<style>.sec{border-radius:10px 10px 0 0;overflow:hidden;margin:30px auto;color:#999;box-shadow:5px 10px 30px;max-width:900px;}
          .sec a{color:#03a9f4}.sec .cnt{background-color:#fff;padding:40px 20px}
          .sec .title{text-align:center;background-color:#03a9f4;color:#fff;padding:10px}</style>
          <div class='sec'><div class='title'><h1>Talk...</h1></div><div class="cnt"><h3>${user.username}, 你好:</h3>
            <p>　　你正在 <a href=${req.headers.origin}>'轻论坛'</a> 进行更改密码操作,点击以下地址更改密码(若无法点击可复制到地址栏打开)，请勿将地址泄露</p>
            <p><a href=${emailLocals}>${emailLocals}</a></p></div></div>`
        };
        
        // send mail with defined transport object
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            return console.log(error);
          }
          console.log('Message sent: %s', info.messageId);
          // Message sent: <04ec7731-cc68-1ef6-303c-61b0f796b78f@qq.com>
        });
        // res.render('page-404.pug', {data: '邮件发送成功，记得回邮箱确认信息 @_@'})
        res.send({message: '邮件发送成功，记得回邮箱确认信息 @_@'})
      } else {
        // res.render('page-404.pug', {data: '用户名或邮箱错误'})
        res.status(403).send({message: '用户名或邮箱错误'})
      }
    })

  // 重置密码
  app.route('/api/reset-password/?:hash')
    .get((req, res, next) => {
      res.cookie('emailFlag', req.params.hash, {
        signed: true
      })
      res.cookie('username', req.params.hash.split('username=')[1], {
        signed: true
      })
      res.send({message: '正在修改密码'})
    })
    .post( async (req, res, next) => {
      console.log(req.signedCookies, req.cookies, req.body)
      let email = encodeURI(req.signedCookies.emailFlag)
    
      if (email == sessions[email] && sessions[email] != undefined) {
        console.log(req.signedCookies.username)
        let username = req.signedCookies.username
    
        await db.run('update users set password = ? where username = ?'
          , req.body.password, username)
    
        console.log('密码修改成功')
        // res.render('page-404.pug', {data: '密码修改成功，请重新登录页面 ~~'})
        res.jsonp({status: 200, data: {data: '密码修改成功，请重新登录页面 ~~'}})
      } else {
        console.log('密码修改失败')
        // res.render('page-404.pug', {data: '密码修改失败，请确认用户名是输入否正确 ~~'})
        res.jsonp({status: 403, data: {data: '密码修改失败，请确认用户名是输入否正确 ~~'}})
      }
    })

  // 判断登录状态
  app.get('/api/isLogin', (req, res, next) => {
    res.send({user: req.user})
  })

// 启动监听，读取数据库
;(async function() {
  db = await dbPromise
  app.listen(port, () => {
    console.log('server is listening on port', port)
  })
}())

// 增加 https 访问
https.createServer({
  key: fs.readFileSync('/root/.acme.sh/bbs.iceeweb.com/bbs.iceeweb.com.key'),
  cert: fs.readFileSync('/root/.acme.sh/bbs.iceeweb.com/bbs.iceeweb.com.cer')
}, app)
  .listen(port2, () => {
  console.log('server listening on port', port2
})
