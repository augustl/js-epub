namespace :jstestdriver do
  desc "Starts a local server"
  task :server do
    exec("jstestdriver --port 4224")
  end

  desc "Runs the tests"
  task :run do
    exec("jstestdriver --tests all --config test/jsTestDriver.conf --reset")
  end
end
